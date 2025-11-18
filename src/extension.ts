import * as vscode from 'vscode';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';


const HookKeys = [
	"class",
	"classloader",
	"method",
	"params",
	"before",
	"after",
	"replace"
];

const ItKeys = [
	"args",
	"result",
	"thisObject",
	"method"
];
const LuaHookGlobals = [
	"hook", "hookAll", "hookctor", "replace",
	"lpparam", "suparam",
	"imports", "log", "printStackTrace",
	"DexFinder", "DexKitBridge",
	"http", "json", "file", "native", "sp",
];



const LuaHookModules: Record<string, string[]> = {
	lpparam: [
		"packageName",
		"classLoader",
		"appInfo",
		"isFirstApplication",
		"processName"
	],
	suparam: [
		"startsSystemServer",
		"modulePath"
	],
	http: ["get", "post", "upload", "delete", "put", "postJson", "head", "download"],
	sp: ["clear", "getAll", "remove", "contains", "get", "set"],
	xphelper: [
		"initContext", "initZygote", "setConfigPath", "setConfigPassword",
		"injectResourcesToContext", "moduleApkPath"
	],
	xsp: ["getAll", "contains", "get", "reload"],
	dexkitbridge: [
		"close", "initFullCache", "setThreadNum", "getDexNum", "exportDexFile",
		"batchFindClassUsingStrings", "batchFindMethodUsingStrings", "findClass", "findMethod",
		"findField", "getClassData", "getMethodData", "getFieldData", "getCallMethods",
		"getInvokeMethods", "create"
	],
	json: ["encode", "decode"],
	dexfinder: [
		"setAutoCloseTime", "create", "getDexKitBridge", "findMethod", "findField", "findClass",
		"clearCache", "resetTimer", "close"
	],
	resources: ["getRConstants", "getColor", "getString", "getResourceId", "getDrawable"],
	file: ["isFile", "isDir", "isExists", "read", "readBytes", "write", "writeBytes", "append",
		"appendBytes", "copy", "move", "rename", "delete", "getName", "getSize"],
	native: ["write", "read", "get_module_base", "module_base", "sleep", "resolve_symbol"]
};



// === 类型定义 ===
interface ScriptConfig {
	enabled: boolean;
	desc: string;
	version: string;
}

interface AppData {
	packageName: string;
	scripts: Map<string, ScriptConfig>;
}

// === 读取配置 ===

function getConfig() {
	const cfg = vscode.workspace.getConfiguration();
	const adbPath = cfg.get<string>('luahook.adbPath', 'adb');
	const remoteRoot = cfg.get<string>('luahook.remoteRoot', '/data/local/tmp/LuaHook');
	const localRootTpl = cfg.get<string>('luahook.localCacheRoot', '${workspaceFolder}/.luahook-cache');

	const workspace = vscode.workspace.workspaceFolders?.[0];
	const workspacePath = workspace ? workspace.uri.fsPath : process.cwd();
	const localRoot = localRootTpl.replace('${workspaceFolder}', workspacePath);

	return { adbPath, remoteRoot, localRoot };
}

function suppressUndefinedGlobals(doc: vscode.TextDocument, collection: vscode.DiagnosticCollection) {
	const filteredDiagnostics: vscode.Diagnostic[] = [];

	for (const diag of vscode.languages.getDiagnostics(doc.uri)) {
		// 忽略 undefined-global 报错
		if (diag.code === "undefined-global") continue;
		if (diag.message.includes("未定义的全局变量")) continue;

		filteredDiagnostics.push(diag);
	}

	collection.set(doc.uri, filteredDiagnostics);
}

async function suExec(cmd: string) {
	// 用 heredoc 执行 su，兼容所有 su 版本
	return runAdb(`shell su << 'EOF'\n${cmd}\nEOF`);
}

function runAdb(cmd: string): Promise<string> {
	const { adbPath } = getConfig();
	return new Promise((resolve, reject) => {
		exec(`${adbPath} ${cmd}`, (err, stdout, stderr) => {
			if (err) {
				reject(stderr || err.message);
			} else {
				resolve(stdout);
			}
		});
	});
}
let logTerminal: vscode.Terminal | null = null;
let logActive = false;

function openLuaXposedLog(realTime: boolean = true) {
	const { adbPath } = getConfig();

	// 创建或复用终端
	if (!logTerminal) {
		logTerminal = vscode.window.createTerminal({
			name: "LuaHook Log"
		});
	}

	logTerminal.show(true);

	// 如果正在运行 logcat，先中断（Ctrl+C）
	if (logActive) {
		logTerminal.sendText("\x03");  // Ctrl + C
		logActive = false;

		// 等待 200ms 让 logcat 退出，然后再重新启动
		setTimeout(() => openLuaXposedLog(realTime), 200);
		return;
	}

	// 清屏
	logTerminal.sendText("clear");

	// 清空旧日志
	logTerminal.sendText(`${adbPath} logcat -c`);

	if (realTime) {
		// 实时流式输出
		logTerminal.sendText(`${adbPath} logcat -v time LuaXposed:* *:S`);
	} else {
		// 只 dump 一次
		logTerminal.sendText(`${adbPath} logcat -d LuaXposed:* *:S`);
	}

	logActive = true;
}
async function createNewLuaHookScript(app: AppData, tree: LuaHookTreeProvider) {
	const { localRoot, remoteRoot } = getConfig();
	const pkg = app.packageName;

	// 1) 输入脚本名
	const scriptName = await vscode.window.showInputBox({
		prompt: `为 ${pkg} 创建新脚本（不含 .lua）`,
		validateInput(v) {
			if (!v.trim()) return "脚本名不能为空";
			if (/[^a-zA-Z0-9_]/.test(v)) return "只能使用字母/数字/下划线";
			return null;
		}
	});
	if (!scriptName) return;

	// 2) 本地路径
	const scriptDir = path.join(localRoot, "LuaHook", "AppScript", pkg);
	const scriptPath = path.join(scriptDir, scriptName + ".lua");

	await fs.promises.mkdir(scriptDir, { recursive: true });

	// 3) 写入脚本模板
	const template =
		`---@diagnostic disable: undefined-global

-- 新脚本：${scriptName}

hook {
    class = "",
    method = "",
    params = {},

    before = function(it)
    end,

    after = function(it)
    end,
}`;

	await fs.promises.writeFile(scriptPath, template);

	// 4) 更新配置文件 AppConf/<pkg>.txt
	const confFile = path.join(localRoot, "LuaHook", "AppConf", `${pkg}.txt`);
	let conf: any = {};

	if (fs.existsSync(confFile)) {
		try {
			conf = JSON.parse(await fs.promises.readFile(confFile, "utf8"));
		} catch { conf = {}; }
	}

	conf[scriptName] = [true, "", "v1.0"];
	await fs.promises.writeFile(confFile, JSON.stringify(conf, null, 2));

	// 5) Push 到设备
	const remoteFile = `${remoteRoot}/AppScript/${pkg}/${scriptName}.lua`;
	const remoteConf = `${remoteRoot}/AppConf/${pkg}.txt`;

	try {
		await runAdb(`push "${scriptPath}" "${remoteFile}"`);
		await runAdb(`push "${confFile}" "${remoteConf}"`);
	} catch {
		vscode.window.showWarningMessage("普通 push 失败，使用 su 推送");

		// await suExec(`mkdir -p '${remoteRoot}/AppScript/${pkg}'`);
		// await suExec(`chmod -R 777 '${remoteRoot}/AppScript/${pkg}'`);
		// await suExec(`chmod -R 777 '${remoteRoot}/AppConf/'`);

		// 创建目录
		await runAdb(`shell su -c "mkdir -p '${remoteRoot}/AppScript/${pkg}'"`);
		await runAdb(`shell su -c "chmod -R 777 '${remoteRoot}/AppScript/${pkg}'"`);
		await runAdb(`shell su -c "chmod -R 777 '${remoteRoot}/AppConf/'"`);

		// base64 传输 .lua
		const data = await fs.promises.readFile(scriptPath);
		const b64 = data.toString("base64");

		// await suExec(`echo '${b64}' | base64 -d > '${remoteFile}'`);
		await runAdb(`shell su -c "echo '${b64}' | base64 -d > '${remoteFile}'"`);

		// push 配置
		const confData = Buffer.from(JSON.stringify(conf, null, 2)).toString("base64");
		// await suExec(`echo '${confData}' | base64 -d > '${remoteConf}'`);
		await runAdb(`shell su -c "echo '${confData}' | base64 -d > '${remoteConf}'"`);
	}

	// 6) tree 刷新
	await tree.reload();

	// 7) 自动打开脚本
	vscode.window.showTextDocument(vscode.Uri.file(scriptPath));

	vscode.window.showInformationMessage(`脚本 ${scriptName} 已创建并上传`);
}


async function pullFromDevice(): Promise<void> {
	const { remoteRoot, localRoot } = getConfig();

	const localLuaHook = path.join(localRoot, "LuaHook");
	const localConf = path.join(localLuaHook, "AppConf");
	const localScript = path.join(localLuaHook, "AppScript");

	await fs.promises.mkdir(localConf, { recursive: true });
	await fs.promises.mkdir(localScript, { recursive: true });

	// 拉取 apps.txt
	await runAdb(`pull "${remoteRoot}/apps.txt" "${localLuaHook}/apps.txt"`);

	// 读取 apps.txt 再逐个 pull 配置 + 脚本
	const appsTxt = await fs.promises.readFile(path.join(localLuaHook, "apps.txt"), "utf8");
	const pkgs = appsTxt.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);

	for (const pkg of pkgs) {
		// 配置
		await runAdb(`pull "${remoteRoot}/AppConf/${pkg}.txt" "${localConf}/${pkg}.txt"`);

		// 脚本目录
		const localAppScriptDir = path.join(localScript, pkg);
		await fs.promises.mkdir(localAppScriptDir, { recursive: true });

		// 拉取脚本（*.lua）
		await runAdb(`shell ls "${remoteRoot}/AppScript/${pkg}"`);
		await runAdb(`pull "${remoteRoot}/AppScript/${pkg}/." "${localAppScriptDir}"`);
	}

	vscode.window.showInformationMessage("LuaHook 配置已从设备拉取（结构已纠正）");
}


async function loadApps(): Promise<AppData[]> {
	const { localRoot } = getConfig();
	const appsTxtPath = path.join(localRoot, 'LuaHook', 'apps.txt');

	if (!fs.existsSync(appsTxtPath)) {
		return [];
	}

	const raw = await fs.promises.readFile(appsTxtPath, 'utf8');

	// 支持逗号+换行分隔
	const pkgList = raw
		.split(/[\n,]+/)
		.map(s => s.trim())
		.filter(Boolean);

	const appConfDir = path.join(localRoot, 'LuaHook', 'AppConf');

	const result: AppData[] = [];

	for (const pkg of pkgList) {
		const confFile = path.join(appConfDir, `${pkg}.txt`);
		const scripts = new Map<string, ScriptConfig>();

		if (fs.existsSync(confFile)) {
			const jsonStr = await fs.promises.readFile(confFile, 'utf8');
			try {
				const obj = JSON.parse(jsonStr) as Record<string, [boolean, string, string]>;
				for (const [name, [enabled, desc, version]] of Object.entries(obj)) {
					scripts.set(name, {
						enabled,
						desc: desc || '',
						version: version || 'v1.0'
					});
				}
			} catch (e) {
				console.error('解析配置失败: ', confFile, e);
			}
		}

		result.push({ packageName: pkg, scripts });
	}

	return result;
}

async function saveAppConfig(app: AppData) {
	const { localRoot } = getConfig();
	const appConfDir = path.join(localRoot, 'LuaHook', 'AppConf');
	await fs.promises.mkdir(appConfDir, { recursive: true });

	const confFile = path.join(appConfDir, `${app.packageName}.txt`);

	const obj: Record<string, [boolean, string, string]> = {};
	for (const [name, cfg] of app.scripts.entries()) {
		obj[name] = [cfg.enabled, cfg.desc, cfg.version];
	}

	await fs.promises.writeFile(confFile, JSON.stringify(obj, null, 2), 'utf8');
}

// === TreeView 实现 ===

class LuaHookTreeItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly contextValue: string,
		public readonly app?: AppData,
		public readonly scriptName?: string
	) {
		super(label, collapsibleState);
	}
}

class LuaHookTreeProvider implements vscode.TreeDataProvider<LuaHookTreeItem> {
	private _onDidChangeTreeData = new vscode.EventEmitter<LuaHookTreeItem | undefined | void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	private apps: AppData[] = [];

	refresh() {
		this._onDidChangeTreeData.fire();
	}

	async reload() {
		this.apps = await loadApps();
		this.refresh();
	}

	getTreeItem(element: LuaHookTreeItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: LuaHookTreeItem): Promise<LuaHookTreeItem[]> {
		if (!element) {
			// 根：app 列表
			if (!this.apps.length) {
				this.apps = await loadApps();
			}

			return this.apps.map(app => {
				const item = new LuaHookTreeItem(
					app.packageName,
					vscode.TreeItemCollapsibleState.Collapsed,
					'luahookApp',
					app
				);
				item.tooltip = `包名: ${app.packageName}`;
				return item;
			});
		}

		if (element.contextValue === 'luahookApp' && element.app) {
			// app 下：脚本列表
			const items: LuaHookTreeItem[] = [];
			for (const [scriptName, cfg] of element.app.scripts.entries()) {
				const label = `${cfg.enabled ? '✅' : '❌'} ${scriptName} (${cfg.version})`;
				const item = new LuaHookTreeItem(
					label,
					vscode.TreeItemCollapsibleState.None,
					'luahookScript',
					element.app,
					scriptName
				);
				item.description = cfg.desc;
				item.tooltip = `启用: ${cfg.enabled}\n版本: ${cfg.version}\n描述: ${cfg.desc}`;
				commandOpenScript(item);

				items.push(item);
			}
			return items;
		}

		return [];
	}
}

// 给脚本节点加一个 command：点击自动打开 .lua 文件
function commandOpenScript(item: LuaHookTreeItem) {
	if (!item.app || !item.scriptName) return;

	const { localRoot } = getConfig();
	const scriptPath = path.join(
		localRoot,
		'LuaHook',
		'AppScript',
		item.app.packageName,
		`${item.scriptName}.lua`
	);

	const uri = vscode.Uri.file(scriptPath);

	// 关键：让 VSCode 把该节点识别成文件
	item.resourceUri = uri;
	item.id = scriptPath;

	item.command = {
		command: 'vscode.open',
		title: '打开脚本',
		arguments: [uri]
	};
}


// === 运行 / 编辑配置 ===

async function runAppHooks(app: AppData) {
	const pkg = app.packageName;
	const { remoteRoot, localRoot } = getConfig();

	// 本地目录
	const localDir = path.join(localRoot, 'LuaHook', 'AppScript', pkg);
	const remoteDir = `${remoteRoot}/AppScript/${pkg}`;

	// 1) 尝试直接 push
	try {
		await runAdb(`push "${localDir}/." "${remoteDir}"`);
	} catch (err: any) {
		const msg = String(err);
		console.warn("普通 push 失败，尝试使用 su 推送 : ", msg);

		// 如果不是权限问题，直接报错
		// if (!msg.includes("Permission denied") && !msg.includes("failed to copy")) {
		//     throw err;
		// }

		vscode.window.showWarningMessage(`普通 push 失败，尝试 su 推送`);

		// 2) 使用 su 创建目录
		await runAdb(`shell su -c "mkdir -p '${remoteDir}'"`);
		await runAdb(`shell su -c "chmod -R 777 '${remoteDir}'"`);
		// await suExec(`mkdir -p ${remoteDir}`);
		// await suExec(`chmod -R 777 ${remoteDir}`);


		// 3) push 全部 .lua 文件（单文件 push + su）
		const files = await fs.promises.readdir(localDir);

		for (const f of files) {
			const localFile = path.join(localDir, f);
			const remoteFile = `${remoteDir}/${f}`;

			// 读取为 Buffer，不做任何 escape
			const data = await fs.promises.readFile(localFile);
			const b64 = data.toString("base64");

			// await suExec(`echo '${b64}' | base64 -d > '${remoteFile}'`);
			// 使用 base64 安全传输
			await runAdb(
				`shell su -c "echo '${b64}' | base64 -d > '${remoteFile}'"`
			);
		}

		vscode.window.showInformationMessage(`已使用 su 推送脚本（Root 模式）`);

	}

	vscode.commands.executeCommand('luahook.openLogs');

	// 4) 杀掉 + 启动 app
	await runAdb(`shell am force-stop ${pkg}`);
	await runAdb(`shell monkey -p ${pkg} -c android.intent.category.LAUNCHER 1`);

	vscode.window.showInformationMessage(`已重启 ${pkg}，脚本已生效`);
}


async function editScriptConfig(app: AppData, scriptName: string, treeProvider: LuaHookTreeProvider) {
	const cfg = app.scripts.get(scriptName);
	if (!cfg) return;

	// 1. 启用/禁用
	const enablePick = await vscode.window.showQuickPick(
		['启用', '禁用'],
		{ placeHolder: `脚本 ${scriptName} 当前状态: ${cfg.enabled ? '启用' : '禁用'}` }
	);
	if (!enablePick) return;
	cfg.enabled = enablePick === '启用';

	// 2. 描述
	const desc = await vscode.window.showInputBox({
		prompt: '脚本描述',
		value: cfg.desc
	});
	if (desc !== undefined) {
		cfg.desc = desc;
	}

	// 3. 版本
	const version = await vscode.window.showInputBox({
		prompt: '脚本版本',
		value: cfg.version || 'v1.0'
	});
	if (version !== undefined) {
		cfg.version = version;
	}

	await saveAppConfig(app);
	treeProvider.refresh();
}

// === activate ===

export function activate(context: vscode.ExtensionContext) {
	const treeProvider = new LuaHookTreeProvider();

	// 注册 TreeView
	vscode.window.createTreeView('luahookAppsView', {
		treeDataProvider: treeProvider
	});

	// 命令：手动拉取配置
	context.subscriptions.push(
		vscode.commands.registerCommand('luahook.pullFromDevice', async () => {
			try {
				await pullFromDevice();
				await treeProvider.reload();
			} catch (e: any) {
				vscode.window.showErrorMessage(`拉取失败: ${e}`);
			}
		})
	);

	// 命令：运行当前 APP
	context.subscriptions.push(
		vscode.commands.registerCommand('luahook.runAppHooks', async (item?: LuaHookTreeItem) => {
			try {
				let app: AppData | undefined;
				if (item && item.app) {
					app = item.app;
				} else {
					vscode.window.showWarningMessage('请在 LuaHook Apps 视图中选择一个 App。');
					return;
				}
				await runAppHooks(app);
			} catch (e: any) {
				vscode.window.showErrorMessage(`运行失败: ${e}`);
			}
		})
	);

	// 命令：编辑脚本配置
	context.subscriptions.push(
		vscode.commands.registerCommand('luahook.editScriptConfig', async (item?: LuaHookTreeItem) => {
			try {
				if (!item || !item.app || !item.scriptName) {
					vscode.window.showWarningMessage('请在 LuaHook Apps 视图中选择一个脚本。');
					return;
				}
				await editScriptConfig(item.app, item.scriptName, treeProvider);
			} catch (e: any) {
				vscode.window.showErrorMessage(`编辑失败: ${e}`);
			}
		})
	);
	// 命令：打开 LuaXposed 日志
	context.subscriptions.push(
		vscode.commands.registerCommand('luahook.openLogs', () => {
			openLuaXposedLog();
		})
	);



	context.subscriptions.push(
		vscode.languages.registerCompletionItemProvider(
			{ language: "lua", scheme: "file" },
			{
				provideCompletionItems(document, position) {
					const line = document.lineAt(position).text;
					const prefix = line.slice(0, position.character).trim();

					const items: vscode.CompletionItem[] = [];

					// =====================================================
					// 1) snippet: hook 模板（只触发一次）
					// =====================================================
					if (prefix === "h" || prefix.endsWith(" hook")) {
						const item = new vscode.CompletionItem("hook", vscode.CompletionItemKind.Snippet);
						item.sortText = "0000";
						item.insertText = new vscode.SnippetString(
							`hook {\n\tclass = "$1",\n\tmethod = "$2",\n\tparams = {$3},\n\n\tbefore = function(it)\n\t\t$4\n\tend,\n\n\tafter = function(it)\n\tend,\n}`
						);
						item.detail = "Hook API (LuaHook)";
						items.push(item);
					}

					// =====================================================
					// 2) 补全：hook { ... } 内的字段
					// =====================================================
					if (line.includes("hook {") || line.match(/^\s*{/)) {
						HookKeys.forEach(k => {
							const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Property);
							item.sortText = "0000";
							item.insertText = k + " = ";
							items.push(item);
						});
					}

					// =====================================================
					// 3) 补全：before/after(it) 中的 it.xxx
					// =====================================================
					if (line.includes("function(it")) {
						ItKeys.forEach(k => {
							const item = new vscode.CompletionItem(k, vscode.CompletionItemKind.Field);
							item.sortText = "0000";
							item.insertText = k;
							items.push(item);
						});
					}

					// =====================================================
					// 4) 补全：模块 API，例如 lpparam.xxx
					// =====================================================
					const matchObj = prefix.match(/(\w+)\.$/);
					if (matchObj) {
						const objName = matchObj[1];
						const api = LuaHookModules[objName];
						if (api) {
							api.forEach(method => {
								const item = new vscode.CompletionItem(method, vscode.CompletionItemKind.Method);
								item.sortText = "0000";
								item.insertText = method;
								items.push(item);
							});
						}
					}

					// =====================================================
					// 5) 全局变量补全（hook, hookAll, log, printStackTrace...）
					// =====================================================
					LuaHookGlobals.forEach(g => {
						if (g.startsWith(prefix) || prefix === "") {
							const item = new vscode.CompletionItem(g, vscode.CompletionItemKind.Variable);
							item.sortText = "0000";
							item.insertText = g;
							items.push(item);
						}
					});

					return items;
				}
			},
			".", "{", "(", "h" // 触发字符
		)
	);



	const diagnostics = vscode.languages.createDiagnosticCollection("luahook");
	context.subscriptions.push(diagnostics);

	vscode.workspace.onDidOpenTextDocument(doc => {
		if (doc.languageId === "lua" && doc.uri.fsPath.includes("LuaHook/AppScript")) {
			suppressUndefinedGlobals(doc, diagnostics);
		}
	});

	vscode.workspace.onDidChangeTextDocument(e => {
		if (e.document.languageId === "lua" && e.document.uri.fsPath.includes("LuaHook/AppScript")) {
			suppressUndefinedGlobals(e.document, diagnostics);
		}
	});

	vscode.workspace.onDidOpenTextDocument(async doc => {
		if (doc.languageId !== "lua") return;
		if (!doc.uri.fsPath.includes("LuaHook\\AppScript")) return;

		const firstLine = doc.lineAt(0).text;
		if (!firstLine.includes("---@diagnostic disable: undefined-global")) {
			const edit = new vscode.WorkspaceEdit();
			edit.insert(
				doc.uri,
				new vscode.Position(0, 0),
				"---@diagnostic disable: undefined-global\n"
			);
			await vscode.workspace.applyEdit(edit);
			await doc.save();
		}
	});

	context.subscriptions.push(
		vscode.commands.registerCommand("luahook.createScript", async (item?: LuaHookTreeItem) => {
			try {
				if (!item?.app) {
					vscode.window.showWarningMessage("请选择一个 App 再创建脚本。");
					return;
				}

				await createNewLuaHookScript(item.app, treeProvider);

			} catch (err: any) {
				vscode.window.showErrorMessage("创建脚本失败: " + err);
			}
		})
	);



}

export function deactivate() { }
