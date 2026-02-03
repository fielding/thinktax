declare module "sparkly" {
  interface SparklyOptions {
    min?: number;
    max?: number;
    style?: "default" | "fire";
  }
  function sparkly(numbers: number[], options?: SparklyOptions): string;
  export default sparkly;
}
