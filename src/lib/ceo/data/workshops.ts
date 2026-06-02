import { unstable_cache } from "next/cache";
import { CEO_CACHE_OPTIONS } from "@/lib/ceo/cache";
import {
  isInternalTestUserOrWorkshopWith,
  isInternalTestWorkshopIdWith,
  loadInternalTestSets,
} from "@/lib/ceo/internal-test/loader";
import { createSupabaseServiceClient } from "@/lib/ceo/supabase";
import { pageAll } from "@/lib/supabase-paging";
import { TABLES } from "@/lib/ceo/tables";
import type {
  WarehouseSubscription,
  WarehouseUser,
  WarehouseWorkshop,
} from "@/lib/ceo/metrics/types";

type DiagnosticRecord = {
  diagnostic_id: string;
  workshop_id: string | null;
  internal_user_id: string | null;
  status: string | null;
  created_at: string | null;
  completed_at: string | null;
  diag_cost: number;
  num_causes: number;
  has_chat: boolean;
  ai_model: string | null;
};

type DiagnosticChatRecord = {
  chat_id: string;
  workshop_id: string | null;
  diagnostic_id: string | null;
  created_at: string | null;
  message_count: number;
  chat_cost: number;
};

export type WorkshopMember = {
  internalUserId: string;
  name: string | null;
  phone: string | null;
  username: string | null;
  role: string | null;
  companyName: string | null;
  emailDomain: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  customerIoId: string | null;
  subscriptionStatus: string | null;
  isInternal: boolean;
  isInternalExempt: boolean;
};

export type WorkshopListItem = {
  workshopId: string;
  name: string;
  isInternal: boolean;
  country: string | null;
  language: string | null;
  createdByAgent: boolean | null;
  planKey: string | null;
  status: string | null;
  coreSubscriptionStatus: string | null;
  paymentStatus: string | null;
  memberCount: number;
  emailDomains: string[];
  usernames: string[];
  lastActivityAt: string | null;
  createdAt: string | null;
  activatedAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerEmail: string | null;
  diagnosticsCount: number;
  diagnosticsCompleted: number;
  diagnosticsLast30Days: number;
  chatSessions: number;
  totalDiagnosticCost: number;
  totalChatCost: number;
  lastDiagnosticAt: string | null;
};

export type WorkshopDetailData = {
  workshop: WorkshopListItem;
  members: WorkshopMember[];
  subscriptions: Array<{
    stripeCustomerId: string | null;
    status: string;
    planKey: string | null;
    currentPeriodEnd: string | null;
    trialEnd: string | null;
    cancelAt: string | null;
    canceledAt: string | null;
  }>;
  recentDiagnostics: Array<{
    diagnosticId: string;
    createdAt: string | null;
    completedAt: string | null;
    status: string | null;
    aiModel: string | null;
    diagCost: number;
    numCauses: number;
    hasChat: boolean;
  }>;
  recentChats: Array<{
    chatId: string;
    diagnosticId: string | null;
    createdAt: string | null;
    messageCount: number;
    chatCost: number;
  }>;
};

function asString(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const next = String(value).trim();
  return next.length > 0 ? next : null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item)).filter(Boolean)
    : [];
}

function normalizeSubscriptionStatus(status: string | null) {
  return status?.trim().toLowerCase() ?? null;
}

function primaryStripeStatus(rows: WarehouseSubscription[]) {
  const priority = new Map<string, number>([
    ["active", 0],
    ["trialing", 1],
    ["paused", 2],
    ["past_due", 3],
    ["unpaid", 4],
    ["incomplete", 5],
    ["incomplete_expired", 6],
    ["canceled", 7],
  ]);

  return rows
    .map((row) => normalizeSubscriptionStatus(row.status))
    .filter((status): status is string => Boolean(status))
    .sort(
      (left, right) =>
        (priority.get(left) ?? 99) - (priority.get(right) ?? 99),
    )[0] ?? null;
}

function compareIsoDesc(left: string | null, right: string | null) {
  const a = left ? new Date(left).getTime() : 0;
  const b = right ? new Date(right).getTime() : 0;
  return b - a;
}

function withinLastDays(iso: string | null, days: number) {
  if (!iso) {
    return false;
  }

  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return false;
  }

  return now - then <= days * 86_400_000;
}

function workshopStatus(
  workshop: WarehouseWorkshop,
  subscriptions: WarehouseSubscription[],
) {
  return (
    primaryStripeStatus(subscriptions) ??
    asString(workshop.metadata?.subscription_status) ??
    null
  );
}

function workshopName(workshop: WarehouseWorkshop, members: WorkshopMember[]) {
  return (
    asString(workshop.name) ??
    asString(workshop.metadata?.company_name) ??
    members.find((member) => member.companyName)?.companyName ??
    workshop.workshop_id
  );
}

function mapMember(
  user: WarehouseUser,
  sets: import("@/lib/ceo/internal-test/loader").InternalTestSets,
): WorkshopMember {
  return {
    internalUserId: user.internal_user_id,
    name: user.name,
    phone: user.phone,
    username: asString(user.metadata?.username),
    role: asString(user.metadata?.user_role),
    companyName: asString(user.metadata?.company_name),
    emailDomain: asString(user.metadata?.email_domain),
    createdAt: user.created_at,
    lastSeenAt: user.last_seen_at,
    customerIoId: user.customer_io_id,
    subscriptionStatus: asString(user.metadata?.subscription_status),
    isInternal: sets.userIds.has(user.internal_user_id),
    isInternalExempt: sets.exemptUserIds.has(user.internal_user_id),
  };
}

function buildWorkshopList(
  workshops: WarehouseWorkshop[],
  users: WarehouseUser[],
  subscriptions: WarehouseSubscription[],
  diagnostics: DiagnosticRecord[],
  chats: DiagnosticChatRecord[],
  sets: import("@/lib/ceo/internal-test/loader").InternalTestSets,
) {
  const usersByWorkshop = new Map<string, WorkshopMember[]>();
  const subscriptionsByWorkshop = new Map<string, WarehouseSubscription[]>();
  const diagnosticsByWorkshop = new Map<string, DiagnosticRecord[]>();
  const chatsByWorkshop = new Map<string, DiagnosticChatRecord[]>();

  for (const user of users) {
    if (!user.workshop_id) continue;
    const current = usersByWorkshop.get(user.workshop_id) ?? [];
    current.push(mapMember(user, sets));
    usersByWorkshop.set(user.workshop_id, current);
  }

  for (const subscription of subscriptions) {
    if (!subscription.workshop_id) continue;
    const current = subscriptionsByWorkshop.get(subscription.workshop_id) ?? [];
    current.push(subscription);
    subscriptionsByWorkshop.set(subscription.workshop_id, current);
  }

  for (const diagnostic of diagnostics) {
    if (!diagnostic.workshop_id) continue;
    const current = diagnosticsByWorkshop.get(diagnostic.workshop_id) ?? [];
    current.push(diagnostic);
    diagnosticsByWorkshop.set(diagnostic.workshop_id, current);
  }

  for (const chat of chats) {
    if (!chat.workshop_id) continue;
    const current = chatsByWorkshop.get(chat.workshop_id) ?? [];
    current.push(chat);
    chatsByWorkshop.set(chat.workshop_id, current);
  }

  return workshops
    .map((workshop) => {
      const members = usersByWorkshop.get(workshop.workshop_id) ?? [];
      const workshopSubscriptions =
        subscriptionsByWorkshop.get(workshop.workshop_id) ?? [];
      const workshopDiagnostics =
        diagnosticsByWorkshop.get(workshop.workshop_id) ?? [];
      const workshopChats = chatsByWorkshop.get(workshop.workshop_id) ?? [];
      const metadata = workshop.metadata ?? {};
      const lastActivityAt =
        asString(metadata.last_activity_at) ??
        members
          .map((member) => member.lastSeenAt)
          .sort(compareIsoDesc)[0] ??
        workshopDiagnostics
          .map((item) => item.created_at)
          .sort(compareIsoDesc)[0] ??
        null;

      return {
        workshopId: workshop.workshop_id,
        name: workshopName(workshop, members),
        isInternal: sets.workshopIds.has(workshop.workshop_id),
        country: workshop.country,
        language: workshop.language,
        createdByAgent: workshop.created_by_agent,
        planKey:
          workshop.plan_key ??
          asStringArray(metadata.plan_types)[0] ??
          workshopSubscriptions[0]?.plan_key ??
          null,
        status: workshopStatus(workshop, workshopSubscriptions),
        coreSubscriptionStatus: workshop.core_subscription_status,
        paymentStatus: workshop.payment_status,
        memberCount:
          Number(metadata.member_count ?? 0) > 0
            ? Number(metadata.member_count)
            : members.length,
        emailDomains:
          asStringArray(metadata.email_domains).length > 0
            ? asStringArray(metadata.email_domains)
            : [...new Set(members.map((member) => member.emailDomain).filter(Boolean))] as string[],
        usernames:
          asStringArray(metadata.usernames).length > 0
            ? asStringArray(metadata.usernames)
            : [...new Set(members.map((member) => member.username).filter(Boolean))] as string[],
        lastActivityAt,
        createdAt: workshop.created_at,
        activatedAt: workshop.activated_at,
        stripeCustomerId:
          asString(metadata.stripe_customer_id) ??
          workshopSubscriptions[0]?.stripe_customer_id ??
          null,
        stripeSubscriptionId: asString(metadata.stripe_subscription_id),
        stripeCustomerEmail: asString(metadata.stripe_customer_email),
        diagnosticsCount: workshopDiagnostics.length,
        diagnosticsCompleted: workshopDiagnostics.filter(
          (item) => item.status === "completed" || item.completed_at,
        ).length,
        diagnosticsLast30Days: workshopDiagnostics.filter((item) =>
          withinLastDays(item.created_at, 30),
        ).length,
        chatSessions: workshopChats.length,
        totalDiagnosticCost: workshopDiagnostics.reduce(
          (sum, item) => sum + Number(item.diag_cost ?? 0),
          0,
        ),
        totalChatCost: workshopChats.reduce(
          (sum, item) => sum + Number(item.chat_cost ?? 0),
          0,
        ),
        lastDiagnosticAt: workshopDiagnostics
          .map((item) => item.created_at)
          .sort(compareIsoDesc)[0] ?? null,
      } satisfies WorkshopListItem;
    })
    .sort((left, right) => {
      const statusScore = (status: string | null) => {
        switch (status) {
          case "active":
            return 0;
          case "trialing":
            return 1;
          case "paused":
            return 2;
          case "past_due":
          case "unpaid":
          case "incomplete":
          case "incomplete_expired":
            return 3;
          case "canceled":
          case "inactive":
            return 4;
          default:
            return 5;
        }
      };

      return (
        statusScore(left.status) - statusScore(right.status) ||
        compareIsoDesc(left.lastActivityAt, right.lastActivityAt) ||
        right.memberCount - left.memberCount ||
        left.name.localeCompare(right.name)
      );
    });
}

async function fetchWarehouseTables(options: { includeInternal?: boolean } = {}) {
  const includeInternal = Boolean(options.includeInternal);
  const sets = await loadInternalTestSets();
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    return {
      workshops: [] as WarehouseWorkshop[],
      users: [] as WarehouseUser[],
      subscriptions: [] as WarehouseSubscription[],
      diagnostics: [] as DiagnosticRecord[],
      chats: [] as DiagnosticChatRecord[],
      sets,
    };
  }

  const [workshopsResult, usersResult, subscriptionsResult, diagnosticsResult, chatsResult] =
    await Promise.all([
      pageAll<WarehouseWorkshop>(({ from, to }) =>
        supabase
          .from(TABLES.workshops)
          .select(
            "workshop_id, name, country, plan_key, created_at, activated_at, language, core_subscription_status, payment_status, trial_end, created_by_agent, core_stripe_customer_id, core_stripe_subscription_id, metadata",
          )
          .order("workshop_id", { ascending: true })
          .range(from, to),
      ),
      pageAll<WarehouseUser>(({ from, to }) =>
        supabase
          .from(TABLES.users)
          .select(
            "internal_user_id, workshop_id, customer_io_id, created_at, last_seen_at, name, phone, core_stripe_customer_id, metadata",
          )
          .order("internal_user_id", { ascending: true })
          .range(from, to),
      ),
      pageAll<WarehouseSubscription>(({ from, to }) =>
        supabase
          .from(TABLES.subscriptions)
          .select(
            "workshop_id, stripe_customer_id, status, plan_key, current_period_start, current_period_end, trial_end, cancel_at, canceled_at",
          )
          .order("stripe_customer_id", { ascending: true })
          .range(from, to),
      ),
      pageAll<DiagnosticRecord>(({ from, to }) =>
        supabase
          .from(TABLES.diagnostics)
          .select(
            "diagnostic_id, workshop_id, internal_user_id, status, created_at, completed_at, diag_cost, num_causes, has_chat, ai_model",
          )
          .order("diagnostic_id", { ascending: true })
          .range(from, to),
      ),
      pageAll<DiagnosticChatRecord>(({ from, to }) =>
        supabase
          .from(TABLES.diagnosticChats)
          .select(
            "chat_id, workshop_id, diagnostic_id, created_at, message_count, chat_cost",
          )
          .order("chat_id", { ascending: true })
          .range(from, to),
      ),
    ]);

  if (
    workshopsResult.error ||
    usersResult.error ||
    subscriptionsResult.error ||
    diagnosticsResult.error ||
    chatsResult.error
  ) {
    throw new Error("Workshop drilldown read failed");
  }

  const allWorkshops = workshopsResult.data;
  const allDiagnostics = diagnosticsResult.data;

  return {
    workshops: includeInternal
      ? allWorkshops
      : allWorkshops.filter(
          (workshop) => !isInternalTestWorkshopIdWith(sets, workshop.workshop_id),
        ),
    users: usersResult.data,
    subscriptions: subscriptionsResult.data,
    diagnostics: includeInternal
      ? allDiagnostics
      : allDiagnostics.filter(
          (diagnostic) =>
            !isInternalTestUserOrWorkshopWith(
              sets,
              diagnostic.internal_user_id,
              diagnostic.workshop_id,
            ),
        ),
    chats: chatsResult.data,
    sets,
  };
}

const getWorkshopDrilldownListCached = unstable_cache(
  (includeInternal: boolean) =>
    getWorkshopDrilldownListUncached({ includeInternal }),
  ["ceo-workshop-list"],
  CEO_CACHE_OPTIONS,
);

export function getWorkshopDrilldownList(
  options: { includeInternal?: boolean } = {},
) {
  return getWorkshopDrilldownListCached(options.includeInternal ?? false);
}

async function getWorkshopDrilldownListUncached(
  options: { includeInternal?: boolean } = {},
) {
  const tables = await fetchWarehouseTables(options);
  return buildWorkshopList(
    tables.workshops,
    tables.users,
    tables.subscriptions,
    tables.diagnostics,
    tables.chats,
    tables.sets,
  );
}

const getWorkshopDetailCached = unstable_cache(
  (workshopId: string) => getWorkshopDetailUncached(workshopId),
  ["ceo-workshop-detail"],
  CEO_CACHE_OPTIONS,
);

export function getWorkshopDetail(
  workshopId: string,
  options: { includeInternal?: boolean } = {},
) {
  // Detail always loads the workshop regardless of the internal toggle, so the
  // cache key is just the workshopId.
  void options;
  return getWorkshopDetailCached(workshopId);
}

async function getWorkshopDetailUncached(
  workshopId: string,
  options: { includeInternal?: boolean } = {},
) {
  // Workshop detail always shows the requested workshop, internal or not — the
  // toggle only governs whether internal workshops show up in the *list*.
  const tables = await fetchWarehouseTables({ includeInternal: true });
  const workshopList = buildWorkshopList(
    tables.workshops,
    tables.users,
    tables.subscriptions,
    tables.diagnostics,
    tables.chats,
    tables.sets,
  );
  void options;
  const workshop = workshopList.find((item) => item.workshopId === workshopId);

  if (!workshop) {
    return null;
  }

  const members = tables.users
    .filter((user) => user.workshop_id === workshopId)
    .map((user) => mapMember(user, tables.sets))
    .sort(
      (left, right) =>
        compareIsoDesc(left.lastSeenAt, right.lastSeenAt) ||
        (left.username ?? left.internalUserId).localeCompare(
          right.username ?? right.internalUserId,
        ),
    );

  const subscriptions = tables.subscriptions
    .filter((subscription) => subscription.workshop_id === workshopId)
    .map((subscription) => ({
      stripeCustomerId: subscription.stripe_customer_id,
      status: subscription.status,
      planKey: subscription.plan_key,
      currentPeriodEnd: subscription.current_period_end,
      trialEnd: subscription.trial_end,
      cancelAt: subscription.cancel_at,
      canceledAt: subscription.canceled_at,
    }))
    .sort((left, right) =>
      compareIsoDesc(left.currentPeriodEnd, right.currentPeriodEnd),
    );

  const recentDiagnostics = tables.diagnostics
    .filter((diagnostic) => diagnostic.workshop_id === workshopId)
    .sort((left, right) => compareIsoDesc(left.created_at, right.created_at))
    .slice(0, 15)
    .map((diagnostic) => ({
      diagnosticId: diagnostic.diagnostic_id,
      createdAt: diagnostic.created_at,
      completedAt: diagnostic.completed_at,
      status: diagnostic.status,
      aiModel: diagnostic.ai_model,
      diagCost: Number(diagnostic.diag_cost ?? 0),
      numCauses: Number(diagnostic.num_causes ?? 0),
      hasChat: Boolean(diagnostic.has_chat),
    }));

  const recentChats = tables.chats
    .filter((chat) => chat.workshop_id === workshopId)
    .sort((left, right) => compareIsoDesc(left.created_at, right.created_at))
    .slice(0, 15)
    .map((chat) => ({
      chatId: chat.chat_id,
      diagnosticId: chat.diagnostic_id,
      createdAt: chat.created_at,
      messageCount: Number(chat.message_count ?? 0),
      chatCost: Number(chat.chat_cost ?? 0),
    }));

  return {
    workshop,
    members,
    subscriptions,
    recentDiagnostics,
    recentChats,
  } satisfies WorkshopDetailData;
}
