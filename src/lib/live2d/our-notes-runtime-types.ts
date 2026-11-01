import type { Live2DParameter } from './studio-state';

/** Adapter contract pinned to ournotes-player 0.1.8; the shell never imports the runtime. */
export interface NativeCharacter {
  core: {
    parameters: {
      ids: string[];
      values: Float32Array;
      minimumValues: Float32Array;
      maximumValues: Float32Array;
      defaultValues: Float32Array;
    };
  };
  params: { value: Float32Array };
  modelUpdate(): void;
  setEyeBlinkEnabled(enabled: boolean): void;
  setLookEnabled(enabled: boolean): void;
  setLookX(value: number): void;
  setLookY(value: number): void;
}
export interface NativeSession {
  character: NativeCharacter;
  motions: string[];
  expressions: string[];
  defaultMotion: string;
  defaultExpression: string;
  step(options?: { draw?: boolean }): Promise<void>;
  render(): void;
  resize(width: number, height: number): void;
  playMotion(name: string, options?: { loop?: boolean }): void;
  setExpression(name: string): void;
  setPhysics(value: boolean): void;
  setBreath(value: boolean): void;
  dispose(): Promise<void>;
}
export interface NativeRuntime {
  AssetStore: {
    fromManifest(
      url: string,
      options: {
        signal: AbortSignal;
        base: string;
        concurrency: number;
        fetch: typeof fetch;
        onProgress: (loaded: number, total: number) => void;
      },
    ): Promise<{ json(path: string): unknown }>;
  };
  ModelSession: {
    create(options: { gl: WebGL2RenderingContext; assets: unknown; width: number; height: number }): Promise<NativeSession>;
  };
}

export function nativeParameters(session: NativeSession): Live2DParameter[] {
  const p = session.character.core.parameters;
  return p.ids.map((id, i) => ({
    id,
    value: p.values[i],
    min: p.minimumValues[i],
    max: p.maximumValues[i],
    default: p.defaultValues[i],
  }));
}
