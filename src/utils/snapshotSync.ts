// One owner per mounted App. Mutations invalidate earlier reads before refreshing.
export const createSnapshotSync = <Value,>(
  load: () => Promise<Value>,
  apply: (value: Value) => void,
  onError: (error: unknown) => void
) => {
  let generation = 0;
  let disposed = false;
  let flight: { generation: number; promise: Promise<Value> } | undefined;
  return {
    refresh() {
      if (disposed) return Promise.reject(new Error('快照同步已结束'));
      if (flight?.generation === generation) return flight.promise;
      const requestGeneration = generation;
      const promise = Promise.resolve().then(() => {
        if (disposed) throw new Error('快照同步已结束');
        return load();
      }).then(value => {
        if (!disposed && requestGeneration === generation) apply(value);
        return value;
      }).catch(error => {
        if (!disposed && requestGeneration === generation) onError(error);
        throw error;
      }).finally(() => {
        if (flight?.promise === promise) flight = undefined;
      });
      flight = { generation: requestGeneration, promise };
      return promise;
    },
    invalidate() { generation += 1; },
    dispose() { disposed = true; generation += 1; }
  };
};
