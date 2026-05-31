import {
  DatasetBackendId,
  DatasetErrorDetail,
  DatasetId,
  DatasetRpcError,
  type DatasetStatusResult,
} from "@t3tools/contracts";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { AuthError, ServerAuth } from "../auth/Services/ServerAuth.ts";
import { LinceiDatasetGateway } from "./LinceiDatasetGateway.ts";
import type { DatasetGatewayContextResult } from "./LinceiDatasetGateway.ts";

const DatasetSelectionHttpInput = Schema.Struct({
  datasetId: Schema.optionalKey(DatasetId),
  backendId: Schema.optionalKey(DatasetBackendId),
});

const DatasetDescribeTableHttpInput = Schema.Struct({
  datasetId: Schema.optionalKey(DatasetId),
  backendId: Schema.optionalKey(DatasetBackendId),
  table: Schema.NonEmptyString,
});

const DatasetQueryHttpInput = Schema.Struct({
  datasetId: Schema.optionalKey(DatasetId),
  backendId: Schema.optionalKey(DatasetBackendId),
  sql: Schema.NonEmptyString,
});

const decodeDatasetSelectionHttpInput = Schema.decodeUnknownEffect(DatasetSelectionHttpInput);

class DatasetHttpPayloadError extends Data.TaggedError("DatasetHttpPayloadError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

function datasetHttpStatus(error: DatasetRpcError): 400 | 500 | 502 {
  switch (error.code) {
    case "policy_denied":
    case "missing_credentials":
    case "invalid_credentials":
    case "dataset_operation_in_progress":
      return 400;
    case "m4_unavailable":
    case "m4_command_failed":
    case "invalid_m4_status":
    case "bigquery_auth_failed":
    case "dataset_initialization_failed":
      return 502;
    case "settings_error":
    case "secret_store_error":
    case "unknown":
      return 500;
  }
  return 500;
}

const respondToDatasetRpcError = (error: DatasetRpcError) =>
  Effect.gen(function* () {
    const status = datasetHttpStatus(error);
    if (status >= 500) {
      yield* Effect.logError("dataset http route failed", {
        code: error.code,
        detail: error.detail,
        cause: error,
      });
    }
    return HttpServerResponse.jsonUnsafe(
      {
        error: error.message,
        datasetError: {
          code: error.code,
          detail: error.detail,
          ...(error.actionableMessage ? { actionableMessage: error.actionableMessage } : {}),
          ...(error.command ? { command: error.command } : {}),
          ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}),
          ...(error.stderr !== undefined ? { stderr: error.stderr } : {}),
        } satisfies DatasetErrorDetail,
      },
      { status },
    );
  });

const respondToDatasetPayloadError = (error: DatasetHttpPayloadError) =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      {
        error: error.message,
      },
      { status: 400 },
    ),
  );

const respondToAuthError = (error: AuthError) =>
  Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      {
        error: error.message,
      },
      { status: error.status ?? 500 },
    ),
  );

const authenticateOwnerSession = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const serverAuth = yield* ServerAuth;
  const session = yield* serverAuth.authenticateHttpRequest(request);
  if (session.role !== "owner") {
    return yield* new AuthError({
      message: "Only owner sessions can access dataset routes.",
      status: 403,
    });
  }
  return session;
});

const parseSelectionFromSearch = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = new URL(request.url, "http://localhost");
  const payload = {
    ...(url.searchParams.has("dataset")
      ? { datasetId: url.searchParams.get("dataset") ?? undefined }
      : {}),
    ...(url.searchParams.has("backend")
      ? { backendId: url.searchParams.get("backend") ?? undefined }
      : {}),
  };
  return yield* decodeDatasetSelectionHttpInput(payload).pipe(
    Effect.mapError(
      (cause) =>
        new DatasetHttpPayloadError({
          message: "Invalid dataset status query parameters.",
          cause,
        }),
    ),
  );
});

const parseSelectionBody = (message: string) =>
  HttpServerRequest.schemaBodyJson(DatasetSelectionHttpInput).pipe(
    Effect.mapError(
      (cause) =>
        new DatasetHttpPayloadError({
          message,
          cause,
        }),
    ),
  );

const parseDescribeTableBody = HttpServerRequest.schemaBodyJson(DatasetDescribeTableHttpInput).pipe(
  Effect.mapError(
    (cause) =>
      new DatasetHttpPayloadError({
        message: "Invalid dataset describe-table payload.",
        cause,
      }),
  ),
);

const parseQueryBody = HttpServerRequest.schemaBodyJson(DatasetQueryHttpInput).pipe(
  Effect.mapError(
    (cause) =>
      new DatasetHttpPayloadError({
        message: "Invalid dataset query payload.",
        cause,
      }),
  ),
);

type DatasetHttpRouteError = DatasetRpcError | DatasetHttpPayloadError | AuthError;

const withDatasetHttpErrors = <A, R>(effect: Effect.Effect<A, DatasetHttpRouteError, R>) =>
  effect.pipe(
    Effect.catchTags({
      AuthError: respondToAuthError,
      DatasetHttpPayloadError: respondToDatasetPayloadError,
      DatasetRpcError: respondToDatasetRpcError,
    }),
  );

const statusRouteLayer = HttpRouter.add(
  "GET",
  "/api/datasets/status",
  withDatasetHttpErrors(
    Effect.gen(function* () {
      yield* authenticateOwnerSession;
      const gateway = yield* LinceiDatasetGateway;
      const selection = yield* parseSelectionFromSearch;
      const status = yield* gateway.status(selection);
      return HttpServerResponse.jsonUnsafe(status satisfies DatasetStatusResult, { status: 200 });
    }),
  ),
);

const capabilitiesRouteLayer = HttpRouter.add(
  "POST",
  "/api/datasets/capabilities",
  withDatasetHttpErrors(
    Effect.gen(function* () {
      yield* authenticateOwnerSession;
      const gateway = yield* LinceiDatasetGateway;
      const input = yield* parseSelectionBody("Invalid dataset capabilities payload.");
      const result = yield* gateway.capabilities(input);
      return HttpServerResponse.jsonUnsafe(result, { status: 200 });
    }),
  ),
);

const schemaRouteLayer = HttpRouter.add(
  "POST",
  "/api/datasets/schema",
  withDatasetHttpErrors(
    Effect.gen(function* () {
      yield* authenticateOwnerSession;
      const gateway = yield* LinceiDatasetGateway;
      const input = yield* parseSelectionBody("Invalid dataset schema payload.");
      const result = yield* gateway.schema(input);
      return HttpServerResponse.jsonUnsafe(result, { status: 200 });
    }),
  ),
);

const describeTableRouteLayer = HttpRouter.add(
  "POST",
  "/api/datasets/describe-table",
  withDatasetHttpErrors(
    Effect.gen(function* () {
      yield* authenticateOwnerSession;
      const gateway = yield* LinceiDatasetGateway;
      const input = yield* parseDescribeTableBody;
      const result = yield* gateway.describeTable(input);
      return HttpServerResponse.jsonUnsafe(result, { status: 200 });
    }),
  ),
);

const queryRouteLayer = HttpRouter.add(
  "POST",
  "/api/datasets/query",
  withDatasetHttpErrors(
    Effect.gen(function* () {
      yield* authenticateOwnerSession;
      const gateway = yield* LinceiDatasetGateway;
      const input = yield* parseQueryBody;
      const result = yield* gateway.query(input);
      return HttpServerResponse.jsonUnsafe(result, { status: 200 });
    }),
  ),
);

const contextRouteLayer = HttpRouter.add(
  "POST",
  "/api/datasets/context",
  withDatasetHttpErrors(
    Effect.gen(function* () {
      yield* authenticateOwnerSession;
      const gateway = yield* LinceiDatasetGateway;
      const input = yield* parseSelectionBody("Invalid dataset context payload.");
      const result = yield* gateway.context(input);
      return HttpServerResponse.jsonUnsafe(result satisfies DatasetGatewayContextResult, {
        status: 200,
      });
    }),
  ),
);

export const datasetHttpRouteLayer = Layer.mergeAll(
  statusRouteLayer,
  capabilitiesRouteLayer,
  schemaRouteLayer,
  describeTableRouteLayer,
  queryRouteLayer,
  contextRouteLayer,
);
