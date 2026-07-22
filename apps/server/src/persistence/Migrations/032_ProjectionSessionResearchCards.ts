import * as Effect from "effect/Effect";

// Historical migration id retained so existing databases keep a continuous
// migration history. Vitrine owns research cards now, so fresh databases do
// not create the legacy projection. Existing tables remain untouched.
export default Effect.void;
