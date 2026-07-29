"use client";

import { CheckIcon } from "lucide-react";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ProviderInstanceId,
  ProviderDriverKind,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";

import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import { cn } from "../../lib/utils";
import { PROVIDER_ACCENT_SWATCHES, normalizeProviderAccentColor } from "../../providerInstances";
import { Button } from "../ui/button";
import { ACPRegistryIcon, Gemini, GithubCopilotIcon, PiAgentIcon, type Icon } from "../Icons";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { RadioGroup } from "../ui/radio-group";
import { toastManager } from "../ui/toast";
import { DRIVER_OPTION_BY_VALUE, DRIVER_OPTIONS } from "./providerDriverMeta";
import { ProviderSettingsForm, deriveProviderSettingsFields } from "./ProviderSettingsForm";
import { AnimatedHeight } from "../AnimatedHeight";
import {
  ADD_PROVIDER_WIZARD_STEPS,
  resolveWizardNavigation,
  type WizardNavigation,
} from "./AddProviderInstanceDialog.logic";
import { AddProviderInstanceWizardSteps } from "./AddProviderInstanceWizardSteps";

/**
 * Normalize a user-provided label into a slug suffix for the instance id.
 * The full id is formed by prefixing the driver slug — e.g. label "Work" on
 * driver "codex" becomes `codex_work`. Output is trimmed to 48 chars so the
 * final composed id stays under the 64-char slug cap enforced by
 * `ProviderInstanceId` in `@t3tools/contracts`.
 */
function slugifyLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

function deriveInstanceId(driver: ProviderDriverKind, label: string): string {
  const slug = slugifyLabel(label);
  return slug ? `${driver}_${slug}` : "";
}

const INSTANCE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
const DEFAULT_DRIVER_OPTION = DRIVER_OPTIONS[0]!;
const EMPTY_CONFIG_DRAFT: Record<string, unknown> = {};
interface ComingSoonDriverOption {
  readonly value: ProviderDriverKind;
  readonly label: string;
  readonly icon: Icon;
}

const COMING_SOON_DRIVER_OPTIONS: readonly ComingSoonDriverOption[] = [
  {
    value: ProviderDriverKind.make("githubCopilot"),
    label: "Github Copilot",
    icon: GithubCopilotIcon,
  },
  {
    value: ProviderDriverKind.make("gemini"),
    label: "Gemini",
    icon: Gemini,
  },
  {
    value: ProviderDriverKind.make("acpRegistry"),
    label: "ACP Registry",
    icon: ACPRegistryIcon,
  },
  {
    value: ProviderDriverKind.make("piAgent"),
    label: "Pi Agent",
    icon: PiAgentIcon,
  },
];

/**
 * Validate an instance id against the same slug rules the server applies in
 * `ProviderInstanceId` (see `packages/contracts/src/providerInstance.ts`).
 * Returns a user-facing error string, or `null` if valid.
 */
function validateInstanceId(id: string, existing: ReadonlySet<string>): string | null {
  if (id.length === 0) return "Instance ID is required.";
  if (id.length > 64) return "Instance ID must be 64 characters or fewer.";
  if (!INSTANCE_ID_PATTERN.test(id)) {
    return "Instance ID must start with a letter and use only letters, digits, '-', or '_'.";
  }
  if (existing.has(id)) return `An instance named '${id}' already exists.`;
  return null;
}

interface AddProviderInstanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddProviderInstanceDialog({ open, onOpenChange }: AddProviderInstanceDialogProps) {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  const [wizardStep, setWizardStep] = useState(0);
  const [driver, setDriver] = useState<ProviderDriverKind>(DEFAULT_DRIVER_KIND);
  const [label, setLabel] = useState("");
  const [accentColor, setAccentColor] = useState<string>("");
  const [instanceId, setInstanceId] = useState("");
  const [instanceIdDirty, setInstanceIdDirty] = useState(false);
  // Driver-specific config drafts keyed by driver so toggling between drivers
  // during the same dialog session does not lose in-progress input.
  const [configByDriver, setConfigByDriver] = useState<Record<string, Record<string, unknown>>>({});
  // Errors are suppressed until a forward navigation or submit needs validation.
  // After that they update live so fixing the problem clears the message in place.
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false);
  const [identityFocusRequest, setIdentityFocusRequest] = useState(0);
  const instanceIdInputRef = useRef<HTMLInputElement>(null);

  const existingIds = useMemo(
    () => new Set(Object.keys(settings.providerInstances ?? {})),
    [settings.providerInstances],
  );

  // Reset the form every time the dialog opens so each creation starts
  // from a clean slate.
  useEffect(() => {
    if (!open) return;
    setDriver(DEFAULT_DRIVER_KIND);
    setLabel("");
    setAccentColor("");
    setInstanceId("");
    setWizardStep(0);
    setInstanceIdDirty(false);
    setConfigByDriver({});
    setHasAttemptedSubmit(false);
    setIdentityFocusRequest(0);
  }, [open]);

  // Auto-derive the instance id from driver + label until the user types
  // in the Instance ID field directly (after which they own its value).
  useEffect(() => {
    if (instanceIdDirty) return;
    setInstanceId(deriveInstanceId(driver, label));
  }, [driver, label, instanceIdDirty]);

  const driverOption = DRIVER_OPTION_BY_VALUE[driver] ?? DEFAULT_DRIVER_OPTION;
  const driverSettingsFields = useMemo(
    () => deriveProviderSettingsFields(driverOption),
    [driverOption],
  );
  const instanceIdError = validateInstanceId(instanceId, existingIds);
  const showInstanceIdError = hasAttemptedSubmit && instanceIdError !== null;
  const previewLabel = label.trim() || `${driverOption.label} Workspace`;
  const wizardStepSummaries = [driverOption.label, previewLabel, null] as const;

  useEffect(() => {
    if (identityFocusRequest === 0 || wizardStep !== 1) return;
    instanceIdInputRef.current?.focus();
  }, [identityFocusRequest, wizardStep]);

  const configDraft = configByDriver[driver] ?? EMPTY_CONFIG_DRAFT;
  const setConfigDraft = useCallback(
    (config: Record<string, unknown> | undefined) => {
      setConfigByDriver((existing) => {
        const next = { ...existing };
        if (config === undefined || Object.keys(config).length === 0) {
          delete next[driver];
        } else {
          next[driver] = config;
        }
        return next;
      });
    },
    [driver],
  );

  const applyWizardNavigation = useCallback((navigation: WizardNavigation) => {
    if (navigation.kind === "blocked") {
      setHasAttemptedSubmit(true);
      setIdentityFocusRequest((request) => request + 1);
    }
    setWizardStep(navigation.step);
  }, []);

  const navigateToStep = useCallback(
    (requestedStep: number) => {
      applyWizardNavigation(
        resolveWizardNavigation(wizardStep, requestedStep, ADD_PROVIDER_WIZARD_STEPS.length, {
          instanceIdError,
        }),
      );
    },
    [applyWizardNavigation, instanceIdError, wizardStep],
  );

  const handleSave = useCallback(() => {
    if (instanceIdError !== null) {
      applyWizardNavigation({
        kind: "blocked",
        step: 1,
        error: instanceIdError,
      });
      return;
    }
    setHasAttemptedSubmit(true);

    const config = configByDriver[driver] ?? {};
    const hasConfig = Object.keys(config).length > 0;
    const normalizedAccentColor = normalizeProviderAccentColor(accentColor);

    const nextInstance: ProviderInstanceConfig = {
      driver,
      enabled: true,
      ...(label.trim().length > 0 ? { displayName: label.trim() } : {}),
      ...(normalizedAccentColor ? { accentColor: normalizedAccentColor } : {}),
      ...(hasConfig ? { config } : {}),
    };
    // `ProviderInstanceId.make` revalidates the slug; we've already checked
    // it via `validateInstanceId`, but going through the brand constructor
    // keeps the type boundary honest and guards against any future drift in
    // the slug rules.
    const brandedId = ProviderInstanceId.make(instanceId);
    const nextMap = {
      ...settings.providerInstances,
      [brandedId]: nextInstance,
    };
    try {
      updateSettings({ providerInstances: nextMap });
      toastManager.add({
        type: "success",
        title: "Provider instance added",
        description: `${driverOption.label} instance '${instanceId}' was added.`,
      });
      onOpenChange(false);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not add provider instance",
        description: error instanceof Error ? error.message : "Update failed.",
      });
    }
  }, [
    driver,
    driverOption,
    applyWizardNavigation,
    configByDriver,
    instanceId,
    instanceIdError,
    label,
    accentColor,
    onOpenChange,
    settings.providerInstances,
    updateSettings,
  ]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl overflow-hidden">
        <div className="flex min-h-0 flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>Add provider instance</DialogTitle>
            <DialogDescription>
              Configure an additional provider instance — for example, a second Codex install
              pointed at a different workspace.
            </DialogDescription>
            <AddProviderInstanceWizardSteps
              currentStep={wizardStep}
              summaries={wizardStepSummaries}
              instanceIdError={instanceIdError}
              onNavigation={applyWizardNavigation}
            />
          </DialogHeader>

          <div
            data-slot="dialog-panel"
            className="space-y-4 bg-secondary px-6 py-5 ring-1 ring-border/70 dark:bg-white/2 dark:ring-white/5"
          >
            <AnimatedHeight>
              <div className={cn("grid gap-2", wizardStep !== 0 && "hidden")}>
                <div id="add-instance-driver-label" className="font-medium text-foreground text-sm">
                  Driver
                </div>
                <RadioGroup
                  value={driver}
                  onValueChange={(value) => setDriver(ProviderDriverKind.make(value))}
                  aria-labelledby="add-instance-driver-label"
                  className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                >
                  {DRIVER_OPTIONS.map((option) => {
                    const IconComponent = option.icon;
                    return (
                      <RadioPrimitive.Root
                        key={option.value}
                        value={option.value}
                        className="relative flex cursor-pointer items-center gap-3 rounded-lg bg-card px-3 py-3 text-left text-muted-foreground outline-none ring-1 ring-border/70 hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring data-checked:bg-primary/8 data-checked:text-foreground data-checked:ring-2 data-checked:ring-primary data-checked:hover:bg-primary/8 dark:bg-white/3 dark:ring-white/5 dark:hover:bg-white/5 dark:data-checked:bg-primary/15 dark:data-checked:ring-primary dark:data-checked:hover:bg-primary/15"
                      >
                        <IconComponent className="size-4 shrink-0" aria-hidden />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {option.label}
                        </span>
                        <RadioPrimitive.Indicator
                          className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"
                          aria-hidden
                        >
                          <CheckIcon className="size-3.5 shrink-0" />
                        </RadioPrimitive.Indicator>
                        {option.badgeLabel ? (
                          <Badge variant="warning" size="sm">
                            {option.badgeLabel}
                          </Badge>
                        ) : null}
                      </RadioPrimitive.Root>
                    );
                  })}
                  {COMING_SOON_DRIVER_OPTIONS.map((option) => {
                    const IconComponent = option.icon;
                    return (
                      <RadioPrimitive.Root
                        key={option.value}
                        value={option.value}
                        disabled
                        className={cn(
                          "relative flex cursor-not-allowed items-center gap-3 rounded-lg bg-card/60 px-3 py-3 text-left opacity-55 outline-none ring-1 ring-border/70 dark:bg-white/2 dark:ring-white/5",
                        )}
                      >
                        <IconComponent
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {option.label}
                        </span>
                        <Badge variant="warning" size="sm">
                          Coming Soon
                        </Badge>
                      </RadioPrimitive.Root>
                    );
                  })}
                </RadioGroup>
              </div>

              <label className={cn("grid gap-2", wizardStep !== 1 && "hidden")}>
                <span className="text-xs font-medium text-foreground">Label</span>
                <Input
                  className="bg-background"
                  placeholder="e.g. Work"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
                <span className="text-[11px] text-muted-foreground">
                  Shown in the provider list. Optional.
                </span>
              </label>

              <label className={cn("grid gap-2", wizardStep !== 1 && "hidden")}>
                <span className="text-xs font-medium text-foreground">Instance ID</span>
                <Input
                  ref={instanceIdInputRef}
                  className="bg-background"
                  placeholder={`${driver}_work`}
                  value={instanceId}
                  onChange={(event) => {
                    setInstanceIdDirty(true);
                    setInstanceId(event.target.value);
                  }}
                  aria-invalid={showInstanceIdError}
                  aria-describedby={
                    showInstanceIdError ? "add-provider-instance-id-error" : undefined
                  }
                />
                {showInstanceIdError ? (
                  <span
                    id="add-provider-instance-id-error"
                    className="text-[11px] text-destructive"
                  >
                    {instanceIdError}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    Routing key used for provider-backed sessions. Letters, digits, '-', or '_'.
                  </span>
                )}
              </label>

              <div className={cn("grid gap-2", wizardStep !== 1 && "hidden")}>
                <span className="text-xs font-medium text-foreground">Accent color</span>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <input
                    type="color"
                    value={normalizeProviderAccentColor(accentColor) ?? PROVIDER_ACCENT_SWATCHES[0]}
                    onChange={(event) => setAccentColor(event.target.value)}
                    aria-label="Provider instance accent color"
                    className="h-8 w-10 cursor-pointer rounded-xl border border-input bg-background p-0.5"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {PROVIDER_ACCENT_SWATCHES.map((swatch) => {
                      const selected = accentColor.toLowerCase() === swatch;
                      return (
                        <button
                          key={swatch}
                          type="button"
                          className={cn(
                            "size-6 cursor-pointer rounded-full border transition",
                            selected
                              ? "scale-110 border-foreground ring-2 ring-ring ring-offset-1 ring-offset-background"
                              : "border-black/10 hover:scale-105 dark:border-white/20",
                          )}
                          style={{ backgroundColor: swatch }}
                          onClick={() => setAccentColor(swatch)}
                          aria-label={`Use ${swatch} accent`}
                        />
                      );
                    })}
                  </div>
                  {accentColor ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-muted-foreground"
                      onClick={() => setAccentColor("")}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Optional marker shown in the picker.
                </span>
              </div>

              {driverSettingsFields.length > 0 ? (
                <div className={cn("grid gap-4", wizardStep !== 2 && "hidden")}>
                  <ProviderSettingsForm
                    definition={driverOption}
                    value={configDraft}
                    idPrefix={`add-provider-${driver}`}
                    variant="dialog"
                    onChange={setConfigDraft}
                  />
                </div>
              ) : wizardStep === 2 ? (
                <div className="grid gap-2">
                  <p className="text-sm text-muted-foreground">
                    This driver has no required configuration. You can add the instance now.
                  </p>
                </div>
              ) : null}
            </AnimatedHeight>
          </div>

          <DialogFooter variant="bare">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (wizardStep === 0) {
                  onOpenChange(false);
                  return;
                }
                setWizardStep((step) => Math.max(0, step - 1));
              }}
            >
              {wizardStep === 0 ? "Cancel" : "Back"}
            </Button>
            {wizardStep < ADD_PROVIDER_WIZARD_STEPS.length - 1 ? (
              <Button size="sm" onClick={() => navigateToStep(wizardStep + 1)}>
                Next
              </Button>
            ) : (
              <Button size="sm" onClick={handleSave}>
                Add instance
              </Button>
            )}
          </DialogFooter>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
