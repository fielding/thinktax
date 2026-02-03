declare module "asciichart" {
  interface PlotConfig {
    offset?: number;
    padding?: string;
    height?: number;
    format?: (x: number, i: number) => string;
    colors?: number[];
  }

  function plot(series: number[] | number[][], config?: PlotConfig): string;

  const black: number;
  const red: number;
  const green: number;
  const yellow: number;
  const blue: number;
  const magenta: number;
  const cyan: number;
  const white: number;
  const reset: number;
  const default_: number;

  export { plot, PlotConfig, black, red, green, yellow, blue, magenta, cyan, white, reset, default_ };
  export default { plot, black, red, green, yellow, blue, magenta, cyan, white, reset, default: default_ };
}
