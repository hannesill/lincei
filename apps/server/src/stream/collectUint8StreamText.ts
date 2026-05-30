import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

export interface CollectedUint8StreamText {
  readonly text: string;
  readonly truncated: boolean;
  readonly bytes: number;
}

export type CollectUint8StreamRetention = "head" | "tail";

interface CollectState {
  chunks: Uint8Array[];
  readonly bytes: number;
  readonly truncated: boolean;
}

export const collectUint8StreamText = <E>(input: {
  readonly stream: Stream.Stream<Uint8Array, E>;
  readonly maxBytes?: number | undefined;
  readonly truncatedMarker?: string | null | undefined;
  readonly retention?: CollectUint8StreamRetention | undefined;
}): Effect.Effect<CollectedUint8StreamText, E> => {
  const maxBytes = input.maxBytes ?? Number.POSITIVE_INFINITY;
  const truncatedMarker = input.truncatedMarker ?? "";
  const retention = input.retention ?? "head";

  return input.stream.pipe(
    Stream.runFold(
      (): CollectState => ({
        chunks: [],
        bytes: 0,
        truncated: false,
      }),
      (state, chunk): CollectState => {
        if (retention === "tail") {
          if (chunk.byteLength >= maxBytes) {
            return {
              chunks: [chunk.slice(chunk.byteLength - maxBytes)],
              bytes: maxBytes,
              truncated: true,
            };
          }

          state.chunks.push(chunk);
          let bytes = state.bytes + chunk.byteLength;
          const truncated = state.truncated || bytes > maxBytes;

          while (bytes > maxBytes) {
            const first = state.chunks[0]!;
            const overflow = bytes - maxBytes;
            if (first.byteLength <= overflow) {
              state.chunks.shift();
              bytes -= first.byteLength;
            } else {
              state.chunks[0] = first.slice(overflow);
              bytes -= overflow;
            }
          }

          return {
            chunks: state.chunks,
            bytes,
            truncated,
          };
        }

        /*
         * keep draining after truncation so the child process can exit normally.
         * its a know issue that on windows killing after the output cap can force an expensive taskkill operation and hurt performance
         */
        if (state.truncated) {
          return state;
        }

        const remainingBytes = maxBytes - state.bytes;
        if (remainingBytes <= 0) {
          return {
            ...state,
            truncated: true,
          };
        }

        const nextChunk =
          chunk.byteLength > remainingBytes ? chunk.slice(0, remainingBytes) : chunk;
        state.chunks.push(nextChunk);
        const bytes = state.bytes + nextChunk.byteLength;
        const truncated = chunk.byteLength > remainingBytes;

        return {
          chunks: state.chunks,
          bytes,
          truncated,
        };
      },
    ),
    Effect.map((state): CollectedUint8StreamText => {
      const text = Buffer.concat(state.chunks, state.bytes).toString("utf8");
      return {
        text:
          retention === "head" && state.truncated && truncatedMarker.length > 0
            ? `${text}${truncatedMarker}`
            : text,
        bytes: state.bytes,
        truncated: state.truncated,
      };
    }),
  );
};
