export type SandboxContext = Record<string, any>;

export class FunctionSandbox {
    private iframe: HTMLIFrameElement | null = null;
    private win: any = null;

    constructor() {
        this.initIframe();
        this.hardenEnvironment();
    }

    private initIframe() {
        this.iframe = document.createElement('iframe');
        this.iframe.style.display = 'none';
        this.iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts');
        document.body.appendChild(this.iframe);
        this.win = this.iframe.contentWindow;

        if (!this.win) {
            this.destroy();
            throw new Error("Sandbox: Failed to initialize iframe window");
        }
    }

    public async run<T>(
        fn: (...args: any[]) => T | Promise<T>,
        args: any[] = [],
        context: SandboxContext = {},
        thisData: any = null,
    ): Promise<T> {
        if (!this.win) {
            throw new Error("Sandbox: Instance has been destroyed. Please create a new BatchSandbox.");
        }

        this.injectContext(context);
        const fnSource = fn.toString();
        const sandboxedFn = this.win.eval(`(${fnSource})`);
        const result = sandboxedFn.apply(thisData, args);

        // 4. 处理异步结果
        if (result && typeof result.then === 'function') {
            return await result;
        } else {
            return result;
        }
    }

    public async eval<T>(
        code: string,
        params: Record<string, any> = {},
        context: SandboxContext = {},
        thisData: any = null,
    ): Promise<T> {
        if (!this.win) {
            throw new Error("Sandbox: Instance has been destroyed. Please create a new BatchSandbox.");
        }

        this.injectContext(context);
        const args = Object.keys(params).join(', ');
        const sandboxedFn = this.win.eval(`(async function(${args}) { ${code} })`);
        const result = sandboxedFn.apply(thisData, Array.from(Object.values(params)));

        // 4. 处理异步结果
        if (result && typeof result.then === 'function') {
            return await result;
        } else {
            return result;
        }
    }

    public destroy(immediately = false) {
        function destructor(self: FunctionSandbox) {
            self.iframe?.parentNode?.removeChild(self.iframe);
            self.iframe = null;
            self.win = null;
        }

        if(immediately)
            destructor(this);
        else
            setTimeout(() => destructor(this), 100);
    }

    public destroyIframe() {
        this.destroy(true);
    }

    private injectContext(context: SandboxContext) {
        if (!this.win) return;
        Object.keys(context).forEach((key) => {
            this.win[key] = context[key];
        });
    }

    private hardenEnvironment() {
        if (!this.win) return;
        const win = this.win;

        const protect = (name: string) => {
            try {
                Object.defineProperty(win, name, {
                    get: () => null, set: () => { },
                    configurable: false, enumerable: false
                });
            } catch (e) {
                console.warn(`Sandbox: Failed to protect ${name}`, e);
            }
        };

        protect('parent');
        protect('top');
        protect('frameElement');

        win.fetch = undefined;
        win.XMLHttpRequest = undefined;
    }

    [Symbol.dispose]() {
        this.destroy(true);
    }
}
