export const evaluatePhase3Readiness = ({
  internalRelease = false,
  externalBlockingItems = [],
  internalBlockingItems = [],
  allowedMissingCredentials = false,
} = {}) => {
  const externalReady = externalBlockingItems.length === 0;
  const internalReady = internalRelease && internalBlockingItems.length === 0;
  const ok = internalRelease ? internalReady : externalReady;
  const issues = internalRelease ? internalBlockingItems : externalBlockingItems;
  const shouldFail = internalRelease ? !internalReady : !externalReady && !allowedMissingCredentials;

  return {
    ok,
    internalReady,
    externalReady,
    issues,
    shouldFail,
  };
};
