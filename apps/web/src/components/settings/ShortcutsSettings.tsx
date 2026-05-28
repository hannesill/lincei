import {
  ChevronDownIcon,
  CircleXIcon,
  EllipsisIcon,
  FileJsonIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  type ShortcutCommand,
  type ShortcutWhenNode,
  type ServerRemoveShortcutInput,
  type ServerUpsertShortcutInput,
} from "@t3tools/contracts";

import { isElectron } from "../../env";
import { openInPreferredEditor } from "../../editorPreferences";
import { formatShortcutLabel } from "../../shortcuts";
import { cn } from "../../lib/utils";
import { ensureLocalApi } from "../../localApi";
import { useServerShortcuts, useServerShortcutsConfigPath } from "../../rpc/serverState";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Kbd, KbdGroup } from "../ui/kbd";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle } from "../ui/toggle";
import { toastManager } from "../ui/toast";
import {
  buildShortcutRows,
  buildShortcutCommandOptions,
  buildWhenVariableOptions,
  commandLabel,
  DEFAULT_WHEN_VARIABLE,
  isKnownWhenVariable,
  shortcutConflictLabels,
  shortcutFromKeyboardEvent,
  parseWhenExpressionDraft,
  type ShortcutCommandOption,
  type ShortcutRow,
  type WhenVariableOption,
  unknownWhenVariables,
  whenAstToExpression,
} from "./ShortcutsSettings.logic";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function ShortcutPill({ value }: { value: string }) {
  const parts = value.split("+");
  return (
    <KbdGroup className="bg-transparent p-0 shadow-none">
      {parts.map((part) => (
        <Kbd key={part} className="min-w-6 justify-center px-1.5">
          {part === "mod"
            ? navigator.platform.toLowerCase().includes("mac")
              ? "⌘"
              : "Ctrl"
            : part === "shift"
              ? "⇧"
              : part === "alt"
                ? navigator.platform.toLowerCase().includes("mac")
                  ? "⌥"
                  : "Alt"
                : part === "ctrl"
                  ? "⌃"
                  : part.length === 1
                    ? part.toUpperCase()
                    : part}
        </Kbd>
      ))}
    </KbdGroup>
  );
}

function ExpandableHeaderSearch({
  query,
  onChange,
  isOpen,
  onOpenChange,
  inputRef,
  collapsedAccessory,
}: {
  query: string;
  onChange: (next: string) => void;
  isOpen: boolean;
  onOpenChange: (next: boolean) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  collapsedAccessory?: ReactNode;
}) {
  if (!isOpen) {
    return (
      <>
        {collapsedAccessory}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                size="icon-xs"
                variant="ghost"
                className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                onClick={() => onOpenChange(true)}
                aria-label="Search shortcuts"
              >
                <SearchIcon className="size-3" />
              </Button>
            }
          />
          <TooltipPopup side="top">Search shortcuts</TooltipPopup>
        </Tooltip>
      </>
    );
  }

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        autoFocus
        type="text"
        value={query}
        onChange={(event) => onChange(event.currentTarget.value)}
        onBlur={() => {
          if (query.length === 0) onOpenChange(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onChange("");
            onOpenChange(false);
          }
        }}
        placeholder="Search shortcuts"
        aria-label="Search shortcuts"
        className="h-6 w-44 rounded-md border border-input bg-background pl-7 pr-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground/72 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24"
      />
    </div>
  );
}

type BooleanOperator = "and" | "or";

function flattenWhenChildren(
  node: ShortcutWhenNode,
  operator: BooleanOperator,
): ShortcutWhenNode[] {
  if (node.type !== operator) return [node];
  return [
    ...flattenWhenChildren(node.left, operator),
    ...flattenWhenChildren(node.right, operator),
  ];
}

function buildWhenExpressionGroup(
  children: readonly ShortcutWhenNode[],
  operator: BooleanOperator,
): ShortcutWhenNode | undefined {
  const first = children[0];
  if (!first) return undefined;
  return children.slice(1).reduce<ShortcutWhenNode>(
    (left, right) => ({
      type: operator,
      left,
      right,
    }),
    first,
  );
}

function conditionParts(node: ShortcutWhenNode): { identifier: string; negated: boolean } | null {
  if (node.type === "identifier") return { identifier: node.name, negated: false };
  if (node.type === "not" && node.node.type === "identifier") {
    return { identifier: node.node.name, negated: true };
  }
  return null;
}

function setConditionIdentifier(node: ShortcutWhenNode, identifier: string): ShortcutWhenNode {
  const parts = conditionParts(node);
  if (!parts) return node;
  const next: ShortcutWhenNode = { type: "identifier", name: identifier };
  return parts.negated ? { type: "not", node: next } : next;
}

function setConditionNegated(node: ShortcutWhenNode, negated: boolean): ShortcutWhenNode {
  const parts = conditionParts(node);
  if (!parts) return negated ? { type: "not", node } : node;
  const identifier: ShortcutWhenNode = { type: "identifier", name: parts.identifier };
  return negated ? { type: "not", node: identifier } : identifier;
}

function defaultWhenCondition(): ShortcutWhenNode {
  return { type: "identifier", name: DEFAULT_WHEN_VARIABLE };
}

function defaultWhenGroup(operator: BooleanOperator = "and"): ShortcutWhenNode {
  return {
    type: operator,
    left: defaultWhenCondition(),
    right: { type: "not", node: defaultWhenCondition() },
  };
}

function UnknownWhenVariableWarning({
  identifiers,
  focusable = true,
}: {
  identifiers: ReadonlyArray<string>;
  focusable?: boolean;
}) {
  if (identifiers.length === 0) return null;
  const label =
    identifiers.length === 1
      ? `Unknown condition: ${identifiers[0]}`
      : `Unknown conditions: ${identifiers.join(", ")}`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={focusable ? 0 : undefined}
            aria-label={label}
            className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-sm text-warning outline-none transition-colors hover:bg-warning/10 focus-visible:ring-[3px] focus-visible:ring-warning/25"
          >
            <TriangleAlertIcon className="size-3.5" />
          </span>
        }
      />
      <TooltipPopup side="top" className="max-w-72 whitespace-normal leading-relaxed">
        Lincei does not recognize this condition yet. It can still be saved, but it may not match
        unless the runtime provides it.
      </TooltipPopup>
    </Tooltip>
  );
}

function ShortcutConflictWarning({ labels }: { labels: ReadonlyArray<string> }) {
  if (labels.length === 0) return null;
  const description =
    labels.length === 1
      ? `Conflicts with ${labels[0]}.`
      : `Conflicts with ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? ", and more" : ""}.`;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={description}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-warning outline-none transition-colors hover:bg-warning/10 focus-visible:ring-[3px] focus-visible:ring-warning/25"
          >
            <TriangleAlertIcon className="size-3.5" />
          </span>
        }
      />
      <TooltipPopup side="top" className="max-w-72 whitespace-normal leading-relaxed">
        {description} The most recent matching binding wins when both conditions can apply.
      </TooltipPopup>
    </Tooltip>
  );
}

function WhenVariableSelect({
  value,
  variables,
  unknownIdentifiers,
  onChange,
}: {
  value: string;
  variables: ReadonlyArray<WhenVariableOption>;
  unknownIdentifiers?: ReadonlyArray<string>;
  onChange: (value: string) => void;
}) {
  const selected = variables.find((option) => option === value);
  const options =
    selected || variables.some((option) => option === value) ? variables : [value, ...variables];

  return (
    <Select value={value} onValueChange={(nextValue) => nextValue && onChange(nextValue)}>
      <SelectTrigger
        size="xs"
        className="h-7 min-h-7 min-w-0 flex-1 rounded-md font-mono text-xs sm:h-7"
      >
        <SelectValue placeholder="Condition" className="leading-7" />
        {unknownIdentifiers && unknownIdentifiers.length > 0 ? (
          <UnknownWhenVariableWarning identifiers={unknownIdentifiers} focusable={false} />
        ) : null}
      </SelectTrigger>
      <SelectContent
        alignItemWithTrigger={false}
        matchTriggerWidth={false}
        popupClassName="w-fit"
        className="max-h-72 w-fit min-w-44"
      >
        {options.map((option) => (
          <SelectItem
            key={option}
            value={option}
            className="min-h-7 w-full py-1 font-mono text-[12px]"
          >
            <span className="truncate">{option}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WhenExpressionNodeEditor({
  node,
  variables,
  depth = 0,
  onChange,
  onRemove,
}: {
  node: ShortcutWhenNode;
  variables: ReadonlyArray<WhenVariableOption>;
  depth?: number;
  onChange: (node: ShortcutWhenNode) => void;
  onRemove?: () => void;
}) {
  const condition = conditionParts(node);

  if (condition) {
    const unknownIdentifiers = isKnownWhenVariable(condition.identifier)
      ? []
      : [condition.identifier];

    return (
      <div className="flex items-center gap-2 rounded-md border border-border/70 bg-background/60 px-2 py-2">
        <Toggle
          pressed={condition.negated}
          onPressedChange={(pressed) => onChange(setConditionNegated(node, pressed))}
          aria-label={`Negate ${condition.identifier}`}
          variant="outline"
          size="xs"
          className="h-7 min-w-10 px-2 text-[11px] sm:h-7"
        >
          Not
        </Toggle>
        <WhenVariableSelect
          value={condition.identifier}
          variables={variables}
          unknownIdentifiers={unknownIdentifiers}
          onChange={(value) => onChange(setConditionIdentifier(node, value))}
        />
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="size-7 sm:size-7"
            aria-label="Remove condition"
            onClick={onRemove}
          >
            <MinusIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
    );
  }

  if (node.type === "not") {
    return (
      <div
        className={cn(
          "space-y-2 rounded-lg border border-border/70 bg-muted/20 p-2",
          depth > 0 && "border-border/50 bg-background/50",
        )}
      >
        <div className="flex items-center gap-2">
          <Toggle
            pressed
            onPressedChange={(pressed) => onChange(pressed ? node : node.node)}
            aria-label="Negate group"
            variant="outline"
            size="xs"
            className="h-7 min-w-10 px-2 text-[11px] sm:h-7"
          >
            Not
          </Toggle>
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="ml-auto size-7 sm:size-7"
              aria-label="Remove negated group"
              onClick={onRemove}
            >
              <MinusIcon className="size-3.5" />
            </Button>
          ) : null}
        </div>
        <div className="relative pl-4">
          <span className="absolute top-0 bottom-0 left-1.5 w-px bg-border/70" aria-hidden />
          <span className="absolute top-4 left-1.5 h-px w-2.5 bg-border/70" aria-hidden />
          <WhenExpressionNodeEditor
            node={node.node}
            variables={variables}
            depth={depth + 1}
            onChange={(next) => onChange({ type: "not", node: next })}
          />
        </div>
      </div>
    );
  }

  const operator: BooleanOperator = node.type === "or" ? "or" : "and";
  const children = flattenWhenChildren(node, operator);
  const childKeyCounts = new Map<string, number>();
  const childEntries = children.map((child) => {
    const baseKey = `${child.type}-${whenAstToExpression(child)}`;
    const count = childKeyCounts.get(baseKey) ?? 0;
    childKeyCounts.set(baseKey, count + 1);
    return { child, key: count === 0 ? baseKey : `${baseKey}-${count}` };
  });

  const updateChild = (target: ShortcutWhenNode, next: ShortcutWhenNode) => {
    let didUpdate = false;
    const nextChildren = children.map((child) => {
      if (!didUpdate && child === target) {
        didUpdate = true;
        return next;
      }
      return child;
    });
    const nextNode = buildWhenExpressionGroup(nextChildren, operator);
    if (nextNode) onChange(nextNode);
  };

  const removeChild = (target: ShortcutWhenNode) => {
    let didRemove = false;
    const nextChildren = children.filter((child) => {
      if (!didRemove && child === target) {
        didRemove = true;
        return false;
      }
      return true;
    });
    const nextNode = buildWhenExpressionGroup(nextChildren, operator);
    if (nextNode) {
      onChange(nextNode);
    } else {
      onChange(defaultWhenCondition());
    }
  };

  const setOperator = (nextOperator: BooleanOperator) => {
    if (nextOperator === operator) return;
    const nextNode = buildWhenExpressionGroup(children, nextOperator);
    if (nextNode) onChange(nextNode);
  };

  const addCondition = () => {
    const nextNode = buildWhenExpressionGroup([...children, defaultWhenCondition()], operator);
    if (nextNode) onChange(nextNode);
  };

  const addGroup = () => {
    const nestedOperator: BooleanOperator = operator === "and" ? "or" : "and";
    const group: ShortcutWhenNode = {
      type: nestedOperator,
      left: defaultWhenCondition(),
      right: { type: "not", node: defaultWhenCondition() },
    };
    const nextNode = buildWhenExpressionGroup([...children, group], operator);
    if (nextNode) onChange(nextNode);
  };

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border border-border/60 bg-muted/10 p-2",
        depth > 0 && "border-border/70 bg-background/55",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Select value={operator} onValueChange={(value) => setOperator(value as BooleanOperator)}>
          <SelectTrigger size="xs" className="h-7 min-h-7 w-24 rounded-md text-xs sm:h-7">
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            alignItemWithTrigger={false}
            matchTriggerWidth={false}
            popupClassName="w-fit"
            className="w-fit min-w-24"
          >
            <SelectItem value="and" className="min-h-7 py-1 font-mono text-[12px]">
              and
            </SelectItem>
            <SelectItem value="or" className="min-h-7 py-1 font-mono text-[12px]">
              or
            </SelectItem>
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="h-7 sm:h-7"
          onClick={addCondition}
        >
          <PlusIcon className="size-3.5" />
          Condition
        </Button>
        <Button type="button" variant="outline" size="xs" className="h-7 sm:h-7" onClick={addGroup}>
          <PlusIcon className="size-3.5" />
          Group
        </Button>
        {onRemove ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="ml-auto size-7 sm:size-7"
            aria-label="Remove group"
            onClick={onRemove}
          >
            <MinusIcon className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <div className="space-y-2">
        {childEntries.map(({ child, key }) => (
          <div key={key} className="relative pl-4">
            <span
              className={cn(
                "absolute top-0 bottom-0 left-1.5 w-px",
                depth === 0 ? "bg-border" : "bg-border/70",
              )}
              aria-hidden
            />
            <span
              className={cn(
                "absolute top-4 left-1.5 h-px w-2.5",
                depth === 0 ? "bg-border" : "bg-border/70",
              )}
              aria-hidden
            />
            <WhenExpressionNodeEditor
              node={child}
              variables={variables}
              depth={depth + 1}
              onChange={(next) => updateChild(child, next)}
              onRemove={() => removeChild(child)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function WhenExpressionBuilder({
  value,
  variables,
  onChange,
  onValidityChange,
}: {
  value: ShortcutWhenNode | undefined;
  variables: ReadonlyArray<WhenVariableOption>;
  onChange: (value: ShortcutWhenNode | undefined) => void;
  onValidityChange?: (valid: boolean) => void;
}) {
  const expression = whenAstToExpression(value);
  const [expressionDraft, setExpressionDraft] = useState(expression);
  const parseResult = useMemo(() => parseWhenExpressionDraft(expressionDraft), [expressionDraft]);
  const parseError = parseResult.ok ? null : parseResult.message;
  const unknownIdentifiers = parseResult.ok ? unknownWhenVariables(parseResult.value) : [];

  const updateExpressionDraft = (nextExpression: string) => {
    setExpressionDraft(nextExpression);
    const nextResult = parseWhenExpressionDraft(nextExpression);
    onValidityChange?.(nextResult.ok);
    if (nextResult.ok) {
      onChange(nextResult.value);
    }
  };

  const updateExpressionValue = (nextValue: ShortcutWhenNode | undefined) => {
    setExpressionDraft(whenAstToExpression(nextValue));
    onValidityChange?.(true);
    onChange(nextValue);
  };

  const addRootCondition = () => {
    if (!value) {
      updateExpressionValue(defaultWhenCondition());
      return;
    }
    updateExpressionValue({ type: "and", left: value, right: defaultWhenCondition() });
  };

  const addRootGroup = () => {
    const group = defaultWhenGroup("or");
    if (!value) {
      updateExpressionValue(group);
      return;
    }
    updateExpressionValue({ type: "and", left: value, right: group });
  };

  return (
    <div className="w-[min(34rem,calc(100vw-2rem))] space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">When</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-7 sm:h-7"
            onClick={addRootCondition}
          >
            <PlusIcon className="size-3.5" />
            Condition
          </Button>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-7 sm:h-7"
            onClick={addRootGroup}
          >
            <PlusIcon className="size-3.5" />
            Group
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="relative">
          <Input
            value={expressionDraft}
            onChange={(event) => updateExpressionDraft(event.currentTarget.value)}
            placeholder="Always"
            aria-invalid={Boolean(parseError)}
            aria-label="When expression"
            className={cn(
              "h-7 rounded-md font-mono text-[12px] leading-7 sm:h-7 sm:leading-7",
              unknownIdentifiers.length > 0 && "pr-9",
              parseError && "border-destructive/70 focus-visible:border-destructive",
            )}
          />
          {unknownIdentifiers.length > 0 ? (
            <span className="absolute inset-y-0 right-2 flex items-center">
              <UnknownWhenVariableWarning identifiers={unknownIdentifiers} />
            </span>
          ) : null}
        </div>
        {parseError ? (
          <div className="flex items-center gap-1.5 text-[11px] text-destructive">
            <CircleXIcon className="size-3.5" />
            {parseError}
          </div>
        ) : null}
      </div>

      <div className="relative">
        {value ? (
          <WhenExpressionNodeEditor
            node={value}
            variables={variables}
            onChange={updateExpressionValue}
            onRemove={() => updateExpressionValue(undefined)}
          />
        ) : (
          <div className="rounded-md border border-dashed border-border/80 bg-muted/15 p-3">
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="xs" className="h-7 sm:h-7" onClick={addRootCondition}>
                <PlusIcon className="size-3.5" />
                Condition
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="h-7 sm:h-7"
                onClick={addRootGroup}
              >
                <PlusIcon className="size-3.5" />
                Group
              </Button>
            </div>
          </div>
        )}
        {parseError ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg border border-destructive/30 bg-background/75 p-4 text-center text-xs text-destructive backdrop-blur-[1px]">
            Fix the expression above to continue editing visually.
          </div>
        ) : null}
      </div>
    </div>
  );
}

type ShortcutRowDraftState = {
  keyDraft: string;
  whenDraft: ShortcutWhenNode | undefined;
  isRecording: boolean;
  isWhenDraftValid: boolean;
};

function createShortcutRowDraft(row: ShortcutRow): ShortcutRowDraftState {
  return {
    keyDraft: row.key,
    whenDraft: row.binding.whenAst,
    isRecording: false,
    isWhenDraftValid: true,
  };
}

function shortcutRowDraftReducer(
  state: ShortcutRowDraftState,
  patch: Partial<ShortcutRowDraftState>,
): ShortcutRowDraftState {
  return { ...state, ...patch };
}

function rowShortcutTarget(row: ShortcutRow): ServerRemoveShortcutInput {
  return {
    command: row.command,
    key: row.key,
    ...(row.when.trim().length > 0 ? { when: row.when } : {}),
  };
}

function ShortcutTableRow({
  row,
  allRows,
  variables,
  isSaving,
  onSave,
  onReset,
  onRemove,
}: {
  row: ShortcutRow;
  allRows: ReadonlyArray<ShortcutRow>;
  variables: ReadonlyArray<WhenVariableOption>;
  isSaving: boolean;
  onSave: (input: ServerUpsertShortcutInput) => void;
  onReset: (row: ShortcutRow) => void;
  onRemove: (row: ShortcutRow) => void;
}) {
  const [draft, setDraft] = useReducer(shortcutRowDraftReducer, row, createShortcutRowDraft);
  const { keyDraft, whenDraft, isRecording, isWhenDraftValid } = draft;
  const whenDraftExpression = whenAstToExpression(whenDraft);
  const isDirty = keyDraft !== row.key || whenDraftExpression !== row.when;
  const displayShortcut = formatShortcutLabel(row.binding.shortcut);
  const canReset = row.source === "Custom" && row.defaultKey !== null;
  const canRemove = row.source !== "Default";
  const hasRowActions = canReset || canRemove;
  const showPill = !isRecording && keyDraft === row.key && row.key.length > 0 && !isDirty;
  const conflictLabels = shortcutConflictLabels(allRows, {
    rowId: row.id,
    key: keyDraft,
    when: whenDraftExpression,
  });

  const save = () => {
    onSave({
      command: row.command,
      key: keyDraft,
      when: whenDraftExpression.trim().length > 0 ? whenDraftExpression : undefined,
      replace: rowShortcutTarget(row),
    });
  };

  const captureShortcut = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Escape") {
      setDraft({ keyDraft: row.key, isRecording: false });
      return;
    }
    const next = shortcutFromKeyboardEvent(event.nativeEvent, navigator.platform);
    if (!next) return;
    setDraft({ keyDraft: next, isRecording: false });
  };

  return (
    <div className="grid grid-cols-[minmax(190px,1.1fr)_minmax(220px,0.85fr)_minmax(210px,1fr)_60px] items-center px-4 py-1.5 text-sm even:bg-muted/15 hover:bg-accent/40">
      <div className="min-w-0 pr-4">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="truncate text-[13px] font-medium text-foreground" title={row.command}>
            {commandLabel(row.command)}
          </div>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-2 pr-4">
        {showPill ? (
          <button
            type="button"
            onClick={() => setDraft({ isRecording: true })}
            aria-label={`Edit shortcut for ${commandLabel(row.command)}`}
            className="group inline-flex h-7 items-center gap-1.5 rounded-md border border-transparent px-1.5 outline-none transition-colors hover:border-border/70 hover:bg-background focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24"
          >
            <ShortcutPill value={row.key} />
            <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground/0 transition-opacity group-hover:text-muted-foreground/70 group-focus-visible:text-muted-foreground/70">
              Edit
            </span>
          </button>
        ) : (
          <Input
            autoFocus={isRecording}
            aria-label={`Shortcut for ${commandLabel(row.command)}`}
            value={isRecording ? "" : keyDraft}
            placeholder={isRecording ? "Press shortcut" : "Unassigned"}
            className={cn(
              "h-7 w-44 rounded-md font-mono text-[12px] sm:h-7",
              isRecording && "border-primary/70 bg-primary/5",
            )}
            onFocus={() => setDraft({ isRecording: true })}
            onBlur={() => setDraft({ isRecording: false })}
            onChange={(event) => setDraft({ keyDraft: event.currentTarget.value })}
            onKeyDown={captureShortcut}
          />
        )}
        {isDirty ? (
          <Button
            size="xs"
            className="h-7 sm:h-7"
            disabled={isSaving || keyDraft.trim().length === 0 || !isWhenDraftValid}
            onClick={save}
          >
            {isSaving ? "Saving" : "Save"}
          </Button>
        ) : null}
      </div>
      <div className="pr-4">
        <Popover>
          <PopoverTrigger
            className={cn(
              "inline-flex h-7 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-left font-mono text-[12px] text-foreground shadow-xs/5 outline-none transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24",
              !whenDraftExpression && "text-muted-foreground",
            )}
            aria-label={`Edit when clause for ${commandLabel(row.command)}`}
          >
            <span className="truncate">{whenDraftExpression || "Always"}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6}>
            <WhenExpressionBuilder
              value={whenDraft}
              variables={variables}
              onChange={(nextWhenDraft) => setDraft({ whenDraft: nextWhenDraft })}
              onValidityChange={(nextIsValid) => setDraft({ isWhenDraftValid: nextIsValid })}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex items-center justify-end gap-1">
        <ShortcutConflictWarning labels={conflictLabels} />
        {hasRowActions ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="size-7 text-muted-foreground hover:text-foreground sm:size-7"
                  disabled={isSaving}
                  aria-label={`Actions for ${commandLabel(row.command)}`}
                />
              }
            >
              <EllipsisIcon className="size-3.5" />
            </MenuTrigger>
            <MenuPopup align="end" className="min-w-36">
              {canReset ? (
                <MenuItem disabled={isSaving} onClick={() => onReset(row)}>
                  Reset to default
                </MenuItem>
              ) : null}
              {canRemove ? (
                <MenuItem variant="destructive" disabled={isSaving} onClick={() => onRemove(row)}>
                  Remove
                </MenuItem>
              ) : null}
            </MenuPopup>
          </Menu>
        ) : null}
        <span className="sr-only">{displayShortcut}</span>
      </div>
    </div>
  );
}

function NewShortcutTableRow({
  commandOptions,
  allRows,
  variables,
  isSaving,
  onSave,
  onCancel,
}: {
  commandOptions: ReadonlyArray<ShortcutCommandOption>;
  allRows: ReadonlyArray<ShortcutRow>;
  variables: ReadonlyArray<WhenVariableOption>;
  isSaving: boolean;
  onSave: (input: ServerUpsertShortcutInput) => void;
  onCancel: () => void;
}) {
  const [commandDraft, setCommandDraft] = useState<ShortcutCommand | "">("");
  const [draft, setDraft] = useReducer(shortcutRowDraftReducer, {
    keyDraft: "",
    whenDraft: undefined,
    isRecording: false,
    isWhenDraftValid: true,
  });
  const { keyDraft, whenDraft, isRecording, isWhenDraftValid } = draft;
  const whenDraftExpression = whenAstToExpression(whenDraft);
  const conflictLabels = shortcutConflictLabels(allRows, {
    rowId: "new",
    key: keyDraft,
    when: whenDraftExpression,
  });
  const commandLabelText = commandDraft ? commandLabel(commandDraft) : "new shortcut";

  const save = () => {
    if (!commandDraft) return;
    onSave({
      command: commandDraft,
      key: keyDraft,
      ...(whenDraftExpression.trim().length > 0 ? { when: whenDraftExpression } : {}),
    });
  };

  const captureShortcut = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Escape") {
      setDraft({ keyDraft: "", isRecording: false });
      return;
    }
    const next = shortcutFromKeyboardEvent(event.nativeEvent, navigator.platform);
    if (!next) return;
    setDraft({ keyDraft: next, isRecording: false });
  };

  return (
    <div className="grid grid-cols-[minmax(190px,1.1fr)_minmax(220px,0.85fr)_minmax(210px,1fr)_60px] items-center px-4 py-1.5 text-sm even:bg-muted/15 hover:bg-accent/40">
      <div className="min-w-0 pr-4">
        <Select
          value={commandDraft}
          onValueChange={(value) => setCommandDraft(value as ShortcutCommand)}
        >
          <SelectTrigger
            size="xs"
            className="h-7 min-h-7 w-full max-w-60 rounded-md text-xs sm:h-7"
          >
            <SelectValue placeholder="Command" />
          </SelectTrigger>
          <SelectContent
            alignItemWithTrigger={false}
            matchTriggerWidth={false}
            className="max-h-72 w-fit min-w-56"
          >
            {commandOptions.map((command) => (
              <SelectItem key={command} value={command} className="min-h-7 w-full py-1 text-[12px]">
                <span className="truncate">{commandLabel(command)}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex min-w-0 items-center gap-2 pr-4">
        <Input
          aria-label={`Shortcut for ${commandLabelText}`}
          value={isRecording ? "" : keyDraft}
          placeholder={isRecording ? "Press shortcut" : "Unassigned"}
          className={cn(
            "h-7 w-44 rounded-md font-mono text-[12px] sm:h-7",
            isRecording && "border-primary/70 bg-primary/5",
          )}
          onFocus={() => setDraft({ isRecording: true })}
          onBlur={() => setDraft({ isRecording: false })}
          onChange={(event) => setDraft({ keyDraft: event.currentTarget.value })}
          onKeyDown={captureShortcut}
        />
        <Button
          size="xs"
          className="h-7 sm:h-7"
          disabled={isSaving || !commandDraft || keyDraft.trim().length === 0 || !isWhenDraftValid}
          onClick={save}
        >
          {isSaving ? "Saving" : "Save"}
        </Button>
      </div>
      <div className="pr-4">
        <Popover>
          <PopoverTrigger
            className={cn(
              "inline-flex h-7 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-left font-mono text-[12px] text-foreground shadow-xs/5 outline-none transition-colors hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24",
              !whenDraftExpression && "text-muted-foreground",
            )}
            aria-label={`Edit when clause for ${commandLabelText}`}
          >
            <span className="truncate">{whenDraftExpression || "Always"}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={6}>
            <WhenExpressionBuilder
              value={whenDraft}
              variables={variables}
              onChange={(nextWhenDraft) => setDraft({ whenDraft: nextWhenDraft })}
              onValidityChange={(nextIsValid) => setDraft({ isWhenDraftValid: nextIsValid })}
            />
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex items-center justify-end gap-1">
        <ShortcutConflictWarning labels={conflictLabels} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="size-7 text-muted-foreground hover:text-foreground sm:size-7"
                disabled={isSaving}
                aria-label="Cancel new shortcut"
                onClick={onCancel}
              />
            }
          >
            <XIcon className="size-3.5" />
          </TooltipTrigger>
          <TooltipPopup side="top">Cancel</TooltipPopup>
        </Tooltip>
      </div>
    </div>
  );
}

export function ShortcutsSettingsPanel() {
  const shortcuts = useServerShortcuts();
  const shortcutsConfigPath = useServerShortcutsConfigPath();
  const [query, setQuery] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [savingCommand, setSavingCommand] = useState<ShortcutCommand | null>(null);
  const [isAddingBinding, setIsAddingBinding] = useState(false);
  const rows = useMemo(() => buildShortcutRows(shortcuts, query), [shortcuts, query]);
  const commandOptions = useMemo(() => buildShortcutCommandOptions(shortcuts), [shortcuts]);
  const whenVariables = useMemo(() => buildWhenVariableOptions(), []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      if (!isMod || event.altKey || event.key.toLowerCase() !== "f") return;

      const target = event.target;
      if (
        target !== searchInputRef.current &&
        target instanceof HTMLElement &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      setIsSearchOpen(true);
      requestAnimationFrame(() => {
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const openShortcutsFile = useCallback(() => {
    if (!shortcutsConfigPath) return;
    void openInPreferredEditor(ensureLocalApi(), shortcutsConfigPath).catch((error: unknown) => {
      toastManager.add({
        title: "Unable to open shortcuts file",
        description: error instanceof Error ? error.message : "The shortcuts file was not opened.",
        type: "error",
      });
    });
  }, [shortcutsConfigPath]);

  const saveShortcut = useCallback((input: ServerUpsertShortcutInput) => {
    setSavingCommand(input.command);
    const payload: ServerUpsertShortcutInput = {
      command: input.command,
      key: input.key.trim(),
      ...(input.when?.trim() ? { when: input.when.trim() } : {}),
      ...(input.replace ? { replace: input.replace } : {}),
    };
    void ensureLocalApi()
      .server.upsertShortcut(payload)
      .then(() => {
        setIsAddingBinding(false);
      })
      .catch((error: unknown) => {
        toastManager.add({
          title: "Unable to save shortcut",
          description: error instanceof Error ? error.message : "The shortcut was not saved.",
          type: "error",
        });
      })
      .finally(() => {
        setSavingCommand(null);
      });
  }, []);

  const removeShortcut = useCallback((row: ShortcutRow) => {
    setSavingCommand(row.command);
    void ensureLocalApi()
      .server.removeShortcut(rowShortcutTarget(row))
      .catch((error: unknown) => {
        toastManager.add({
          title: "Unable to remove shortcut",
          description: error instanceof Error ? error.message : "The shortcut was not removed.",
          type: "error",
        });
      })
      .finally(() => {
        setSavingCommand(null);
      });
  }, []);

  const resetShortcut = useCallback(
    (row: ShortcutRow) => {
      if (!row.defaultKey) return;
      saveShortcut({
        command: row.command,
        key: row.defaultKey,
        when: row.defaultWhen.trim().length > 0 ? row.defaultWhen : undefined,
        replace: {
          command: row.command,
          key: row.key,
          ...(row.when.trim().length > 0 ? { when: row.when } : {}),
        },
      });
    },
    [saveShortcut],
  );

  const bindingsCount = (
    <span className="text-[11px] text-muted-foreground">
      {rows.length + (isAddingBinding ? 1 : 0)}{" "}
      {rows.length + (isAddingBinding ? 1 : 0) === 1 ? "binding" : "bindings"}
    </span>
  );

  return (
    <SettingsPageContainer className="max-w-5xl">
      <SettingsSection
        title="Shortcuts"
        headerAction={
          <div className="flex items-center gap-1.5">
            <ExpandableHeaderSearch
              query={query}
              onChange={setQuery}
              isOpen={isSearchOpen}
              onOpenChange={setIsSearchOpen}
              inputRef={searchInputRef}
              collapsedAccessory={bindingsCount}
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsAddingBinding(true)}
                    aria-label="Add shortcut"
                  >
                    <PlusIcon className="size-3" />
                  </Button>
                }
              />
              <TooltipPopup side="top">Add shortcut</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    disabled={!shortcutsConfigPath}
                    onClick={openShortcutsFile}
                    aria-label="Open shortcuts.json"
                  >
                    <FileJsonIcon className="size-3" />
                  </Button>
                }
              />
              <TooltipPopup side="top">Open shortcuts.json</TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        {!isElectron ? (
          <div className="flex items-start gap-2 border-b border-warning/20 bg-warning/5 px-3 py-2.5 text-[12px] leading-relaxed text-muted-foreground sm:px-4">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <p>
              Some shortcuts may be claimed by the browser before Lincei sees them. Use the desktop
              app for better shortcut support.
            </p>
          </div>
        ) : null}

        <ScrollArea
          chainVerticalScroll
          scrollFade
          hideScrollbars
          className="w-full max-w-full rounded-none"
        >
          <div className="grid min-w-[680px] grid-cols-[minmax(190px,1.1fr)_minmax(220px,0.85fr)_minmax(210px,1fr)_60px] border-b border-border/70 bg-muted/25 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            <div>Command</div>
            <div>Shortcut</div>
            <div>When</div>
            <div>Status</div>
          </div>
          <div className="min-w-[680px] divide-y divide-border/60">
            {isAddingBinding ? (
              <NewShortcutTableRow
                commandOptions={commandOptions}
                allRows={rows}
                variables={whenVariables}
                isSaving={savingCommand !== null}
                onSave={saveShortcut}
                onCancel={() => setIsAddingBinding(false)}
              />
            ) : null}
            {rows.map((row) => (
              <ShortcutTableRow
                key={row.id}
                row={row}
                allRows={rows}
                variables={whenVariables}
                isSaving={savingCommand === row.command}
                onSave={saveShortcut}
                onReset={resetShortcut}
                onRemove={removeShortcut}
              />
            ))}
            {rows.length === 0 && !isAddingBinding ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                No shortcuts match your search.
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </SettingsSection>
    </SettingsPageContainer>
  );
}
