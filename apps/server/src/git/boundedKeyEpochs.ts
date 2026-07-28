export interface BoundedKeyEpochs {
  readonly get: (key: string) => number;
  readonly bump: (key: string) => number;
  readonly isCurrent: (key: string, epoch: number) => boolean;
  readonly size: () => number;
}

export function makeBoundedKeyEpochs(capacity: number): BoundedKeyEpochs {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new RangeError("Key epoch capacity must be a positive safe integer.");
  }

  const epochByKey = new Map<string, number>();
  let nextEpoch = 1;
  const assignNextEpoch = (key: string) => {
    if (!Number.isSafeInteger(nextEpoch)) {
      throw new RangeError("Key epochs exhausted the safe integer range.");
    }

    if (epochByKey.has(key)) {
      epochByKey.delete(key);
    } else if (epochByKey.size >= capacity) {
      const oldestKey = epochByKey.keys().next().value;
      if (oldestKey !== undefined) {
        epochByKey.delete(oldestKey);
      }
    }

    const epoch = nextEpoch;
    nextEpoch += 1;
    epochByKey.set(key, epoch);
    return epoch;
  };

  return {
    get: (key: string) => {
      const epoch = epochByKey.get(key);
      if (epoch === undefined) {
        return assignNextEpoch(key);
      }

      epochByKey.delete(key);
      epochByKey.set(key, epoch);
      return epoch;
    },
    bump: assignNextEpoch,
    isCurrent: (key: string, epoch: number) => epochByKey.get(key) === epoch,
    size: () => epochByKey.size,
  };
}
