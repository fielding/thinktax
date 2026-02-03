declare module "vega" {
  export class View {
    constructor(runtime: any, config?: any);
    initialize(): this;
    toCanvas(): Promise<any>;
    finalize(): this;
  }
  export function parse(spec: any): any;
}

declare module "vega-lite" {
  export function compile(spec: any): { spec: any };
}
