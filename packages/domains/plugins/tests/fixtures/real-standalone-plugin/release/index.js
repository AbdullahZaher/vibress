/**
 * Real standalone plugin entrypoint conforming to Vibress Plugin SDK.
 * Dynamically loaded and executed inside Tier 2 isolated runtime.
 */

export async function activate(ctx) {
  return {
    activated: true,
    publicationId: ctx.publicationId,
  };
}

export async function deactivate(ctx) {
  return {
    deactivated: true,
  };
}

export async function onEvent(eventName, payload, ctx) {
  return {
    handled: true,
    eventName,
    payload,
    publicationId: ctx.publicationId,
  };
}

export async function invoke(input, ctx) {
  if (input.op === "write_storage") {
    const created = await ctx.storage.create(input.modelKey, input.id, input.fields);
    return { ok: true, created };
  }

  if (input.op === "read_storage") {
    const item = await ctx.storage.get(input.modelKey, input.id);
    return { ok: true, item };
  }

  if (input.op === "read_secret") {
    const secret = await ctx.getSecret(input.key);
    return { ok: true, secret };
  }

  if (input.op === "unauthorized_capability_attempt") {
    // Attempt to invoke member plan capability not granted in manifest
    return await ctx.memberAccess.hasActivePlan(input.planId || "plan-pro");
  }

  if (input.op === "check_capability") {
    return {
      hasStorageRead: ctx.hasCapability("extension.storage.read"),
      hasMemberRead: ctx.hasCapability("entitlements.plan.read"),
    };
  }

  return {
    status: "success",
    operation: "invoke",
    received: input,
    publicationId: ctx.publicationId,
  };
}

export default {
  activate,
  deactivate,
  onEvent,
  invoke,
};
