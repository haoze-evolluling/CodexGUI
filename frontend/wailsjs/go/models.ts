export namespace backend {
	
	export class ActionResult {
	    ok: boolean;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new ActionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.error = source["error"];
	    }
	}
	export class AppSettings {
	    theme: string;
	    fontSize: string;
	    codexPath?: string;
	
	    static createFrom(source: any = {}) {
	        return new AppSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.theme = source["theme"];
	        this.fontSize = source["fontSize"];
	        this.codexPath = source["codexPath"];
	    }
	}
	export class InstallationStatus {
	    status: string;
	    path?: string;
	    source?: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new InstallationStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.path = source["path"];
	        this.source = source["source"];
	        this.error = source["error"];
	    }
	}
	export class Provider {
	    id: string;
	    name: string;
	    baseUrl: string;
	    model: string;
	    reasoningEffort: string;
	    hasApiKey: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Provider(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.baseUrl = source["baseUrl"];
	        this.model = source["model"];
	        this.reasoningEffort = source["reasoningEffort"];
	        this.hasApiKey = source["hasApiKey"];
	    }
	}
	export class ProviderState {
	    activeId: string;
	    model: string;
	    reasoningEffort: string;
	    providers: Provider[];
	
	    static createFrom(source: any = {}) {
	        return new ProviderState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.activeId = source["activeId"];
	        this.model = source["model"];
	        this.reasoningEffort = source["reasoningEffort"];
	        this.providers = this.convertValues(source["providers"], Provider);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class BootstrapState {
	    settings: AppSettings;
	    providers: ProviderState;
	    installation: InstallationStatus;
	
	    static createFrom(source: any = {}) {
	        return new BootstrapState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.settings = this.convertValues(source["settings"], AppSettings);
	        this.providers = this.convertValues(source["providers"], ProviderState);
	        this.installation = this.convertValues(source["installation"], InstallationStatus);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class ProviderInput {
	    id?: string;
	    name: string;
	    baseUrl: string;
	    apiKey: string;
	    model: string;
	    reasoningEffort: string;
	
	    static createFrom(source: any = {}) {
	        return new ProviderInput(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.baseUrl = source["baseUrl"];
	        this.apiKey = source["apiKey"];
	        this.model = source["model"];
	        this.reasoningEffort = source["reasoningEffort"];
	    }
	}
	export class ProviderResult {
	    ok: boolean;
	    error?: string;
	    state: ProviderState;
	
	    static createFrom(source: any = {}) {
	        return new ProviderResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.error = source["error"];
	        this.state = this.convertValues(source["state"], ProviderState);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class Session {
	    id: string;
	    threadId: string;
	    title: string;
	    cwd: string;
	    updated: number;
	    model?: string;
	    archivedAt?: number;
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.threadId = source["threadId"];
	        this.title = source["title"];
	        this.cwd = source["cwd"];
	        this.updated = source["updated"];
	        this.model = source["model"];
	        this.archivedAt = source["archivedAt"];
	    }
	}

}

