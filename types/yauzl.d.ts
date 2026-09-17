declare module "yauzl" {
  import type { Readable } from "node:stream";

  export type YauzlEntry = {
    fileName: string;
    compressedSize: number;
    uncompressedSize: number;
  };

  export type YauzlZipFile = {
    readEntry: () => void;
    openReadStream: (
      entry: YauzlEntry,
      callback: (err: Error | null, stream?: Readable) => void
    ) => void;
    on: (event: string, listener: (...args: any[]) => void) => void;
    close?: () => void;
  };

  export function open(
    path: string,
    options: { lazyEntries?: boolean; autoClose?: boolean },
    callback: (err: Error | null, zipfile?: YauzlZipFile) => void
  ): void;

  const yauzl: { open: typeof open };
  export default yauzl;
}
