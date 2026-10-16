/** Compact private client directory: list, search, create, edit, detail with related cases. */
import { useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import {
  Archive,
  ArrowRight,
  Building2,
  ChevronLeft,
  FileSearch,
  Mail,
  PencilLine,
  Loader2,
  Phone,
  Pin,
  PinOff,
  Plus,
  Search,
  UserRound,
  Users,
} from 'lucide-react';
import { Skeleton } from '@/components/kit';
import { ClientFormDialog, clientTypeLabel, GHOST, SOLID } from '@/components/client-form';
import { useClient, useClients, usePinClient } from '@/lib/workspace-api';
import { useToast } from '@/hooks/use-toast';
import { guardReportNavigation } from '@/lib/report-draft-guard';
import { formatShortDate } from '@/lib/case-drafts';
export function ClientsPanel({ initialClientId = null }) {
  const clients = useClients();
  const pin = usePinToggle();
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState(initialClientId);
  const [form, setForm] = useState(null);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return [...(clients.data ?? [])]
      .filter(
        (c) =>
          !t ||
          [c.name, c.reference, c.mobile, c.email].some((v) => (v ?? '').toLowerCase().includes(t)),
      )
      .sort(
        (a, b) => Number(!!b.pinned) - Number(!!a.pinned) || a.name.localeCompare(b.name, 'ar'),
      );
  }, [clients.data, q]);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="panel-clients">
      <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
        <section className={`min-h-0 flex-col border-l ${selected ? 'hidden md:flex' : 'flex'}`}>
          <div className="space-y-3 border-b p-4">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h1 className="text-[18px] font-semibold tracking-tight">الموكلون</h1>
                <p className="text-[12px] text-muted-foreground">
                  {clients.data
                    ? `${clients.data.length.toLocaleString('ar-SA')} سجل خاص`
                    : 'سجلات خاصة بحسابك'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setForm({})}
                className={`${SOLID} min-h-10 px-3`}
                data-testid="button-new-client"
              >
                <Plus className="h-4 w-4" />
                موكل
              </button>
            </div>
            <div className="relative">
              <Search
                className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="بحث بالاسم أو المرجع أو الجوال"
                aria-label="بحث في الموكلين"
                className="min-h-10 w-full rounded-lg border bg-background pr-9 pl-3 text-[13.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-testid="input-search-clients"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {clients.isLoading ? (
              <div className="space-y-2 p-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : clients.isError ? (
              <div className="p-4 text-[13px] text-muted-foreground">
                تعذّر تحميل الموكلين.{' '}
                <button
                  className="font-medium text-foreground underline"
                  onClick={() => void clients.refetch()}
                  data-testid="button-retry-clients"
                >
                  إعادة المحاولة
                </button>
              </div>
            ) : list.length === 0 ? (
              <div
                className="flex flex-col items-center px-6 py-12 text-center"
                data-testid="text-clients-empty"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent">
                  <Users className="h-5 w-5 text-muted-foreground" />
                </span>
                <p className="mt-3 text-[14px] font-medium">
                  {q ? 'لا نتائج مطابقة' : 'لا يوجد موكلون بعد'}
                </p>
                <p className="mt-1 text-[12.5px] leading-6 text-muted-foreground">
                  {q ? 'جرّب كلمة أخرى.' : 'أضف موكلًا ثم اربطه بقضاياه من إدارة القضية.'}
                </p>
              </div>
            ) : (
              <ul className="space-y-0.5" data-testid="list-clients">
                {list.map((c) => (
                  <li key={c.id} className="flex items-center">
                    <button
                      type="button"
                      onClick={() => setSelected(c.id)}
                      aria-current={selected === c.id ? 'true' : undefined}
                      data-testid={`button-client-${c.id}`}
                      className={`flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2 text-right ${selected === c.id ? 'bg-accent' : 'hover:bg-accent/60'}`}
                    >
                      <Initial name={c.name} type={c.type} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{c.name}</span>
                        <span className="block truncate text-[12px] text-muted-foreground">
                          {[clientTypeLabel(c.type), c.reference].filter(Boolean).join(' · ') ||
                            'دون تفاصيل إضافية'}
                        </span>
                      </span>
                      <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                    <PinButton client={c} pin={pin} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
        <section className={`min-h-0 overflow-y-auto ${selected ? 'block' : 'hidden md:block'}`}>
          {selected ? (
            <ClientDetail
              clientId={selected}
              onBack={() => setSelected(null)}
              onEdit={(c) => setForm({ client: c })}
            />
          ) : (
            <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <UserRound className="h-6 w-6" />
              <p className="mt-2 text-[13.5px]">اختر موكلًا لعرض بياناته وقضاياه.</p>
            </div>
          )}
        </section>
      </div>
      {form && (
        <ClientFormDialog
          client={form.client}
          onClose={() => setForm(null)}
          onSaved={(c) => setSelected(c.id)}
        />
      )}
    </div>
  );
}
function usePinToggle() {
  const m = usePinClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(new Set());
  const toggle = (c) => {
    if (busy.has(c.id)) return;
    setBusy((s) => new Set(s).add(c.id));
    m.mutate(
      { clientId: c.id, data: { pinned: !c.pinned } },
      {
        onSuccess: () =>
          toast({ title: c.pinned ? 'أُلغي تثبيت الموكل' : 'ثُبّت الموكل في الصفحة الرئيسية' }),
        onError: () =>
          toast({ title: 'تعذّر الحفظ', description: 'حاول مرة أخرى.', variant: 'destructive' }),
        onSettled: () =>
          setBusy((s) => {
            const n = new Set(s);
            n.delete(c.id);
            return n;
          }),
      },
    );
  };
  return { toggle, busy };
}
function PinButton({ client, pin, labeled = false }) {
  const pending = pin.busy.has(client.id);
  const Icon = pending ? Loader2 : client.pinned ? PinOff : Pin;
  const label = client.pinned ? 'إلغاء التثبيت' : 'تثبيت';
  return (
    <button
      type="button"
      onClick={() => pin.toggle(client)}
      disabled={pending}
      aria-pressed={!!client.pinned}
      aria-label={`${label}: ${client.name}`}
      data-testid={`button-pin-client-${client.id}`}
      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-md text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${labeled ? 'border px-3 hover:bg-accent' : `w-11 hover:bg-accent ${client.pinned ? 'text-foreground' : 'text-muted-foreground/70'}`}`}
    >
      <Icon className={`h-4 w-4 ${pending ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      {labeled && <span>{label}</span>}
    </button>
  );
}
function Initial({ name, type }) {
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[14px] font-semibold text-primary">
      {name.trim().charAt(0)}
      {type === 'organization' && (
        <Building2
          className="absolute -bottom-0.5 -left-0.5 h-4 w-4 rounded-full bg-background p-0.5 text-muted-foreground"
          aria-label="جهة"
        />
      )}
    </span>
  );
}
function ClientDetail({ clientId, onBack, onEdit }) {
  const detail = useClient(clientId);
  const pin = usePinToggle();
  const [, navigate] = useLocation();
  if (detail.isLoading)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  if (detail.isError || !detail.data)
    return (
      <div className="p-6 text-[13.5px] text-muted-foreground">
        <button onClick={onBack} className="mb-3 inline-flex items-center gap-1 md:hidden">
          <ArrowRight className="h-4 w-4" />
          الموكلون
        </button>
        <p>
          تعذّر تحميل بيانات الموكل.{' '}
          <button
            className="font-medium text-foreground underline"
            onClick={() => void detail.refetch()}
            data-testid="button-retry-client"
          >
            إعادة المحاولة
          </button>
        </p>
      </div>
    );
  const { client, cases } = detail.data;
  const active = cases.filter((c) => !c.archivedAt);
  const archived = cases.filter((c) => c.archivedAt);
  return (
    <div className="mx-auto w-full max-w-2xl p-4 sm:p-6" data-testid="panel-client-detail">
      <button
        onClick={onBack}
        className="mb-3 inline-flex min-h-10 items-center gap-1 text-[13px] text-muted-foreground md:hidden"
        data-testid="button-back-clients"
      >
        <ArrowRight className="h-4 w-4" />
        الموكلون
      </button>
      <div className="flex flex-wrap items-start gap-3">
        <Initial name={client.name} type={client.type} />
        <div className="min-w-0 flex-1">
          <h2
            className="text-[19px] font-semibold leading-7 [overflow-wrap:anywhere]"
            data-testid="text-client-name"
          >
            {client.name}
          </h2>
          <p className="text-[12.5px] text-muted-foreground">
            {clientTypeLabel(client.type) || 'صفة غير محددة'}
            {client.reference ? ` · ${client.reference}` : ''}
          </p>
        </div>
        <PinButton client={client} pin={pin} labeled />
        <button
          onClick={() => onEdit(client)}
          className={`${GHOST} min-h-10 px-3`}
          data-testid="button-edit-client"
        >
          <PencilLine className="h-4 w-4" />
          تعديل
        </button>
      </div>
      {(client.mobile || client.email) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {client.mobile && (
            <a
              href={`tel:${client.mobile}`}
              dir="ltr"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] hover:bg-accent"
              data-testid="link-client-mobile"
            >
              <Phone className="h-3.5 w-3.5" />
              {client.mobile}
            </a>
          )}
          {client.email && (
            <a
              href={`mailto:${client.email}`}
              dir="ltr"
              className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border px-3 text-[13px] hover:bg-accent"
              data-testid="link-client-email"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{client.email}</span>
            </a>
          )}
        </div>
      )}
      {client.notes && (
        <p
          className="mt-4 whitespace-pre-wrap rounded-lg bg-accent/50 p-3 text-[13.5px] leading-7"
          data-testid="text-client-notes"
        >
          {client.notes}
        </p>
      )}
      <h3 className="mt-6 text-[13px] font-semibold text-muted-foreground">
        القضايا المرتبطة{' '}
        <span className="tabular-nums">{cases.length.toLocaleString('ar-SA')}</span>
      </h3>
      {cases.length === 0 ? (
        <p
          className="mt-2 rounded-lg border border-dashed p-4 text-[13px] leading-6 text-muted-foreground"
          data-testid="text-client-no-cases"
        >
          لا توجد قضايا مرتبطة. اربط قضية من زر «إدارة القضية» في رأس القضية.
        </p>
      ) : (
        <ul
          className="mt-2 divide-y overflow-hidden rounded-lg border bg-card"
          data-testid="list-client-cases"
        >
          {[...active, ...archived].map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => guardReportNavigation(() => navigate(`/cases/${c.id}`))}
                data-testid={`button-open-client-case-${c.id}`}
                className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-right hover:bg-accent"
              >
                {c.archivedAt ? (
                  <Archive className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <FileSearch className="h-4 w-4 shrink-0 text-primary" />
                )}
                <span className="min-w-0 flex-1 truncate text-[13.5px]">
                  {c.title || 'قضية بدون عنوان'}
                </span>
                {c.archivedAt && (
                  <span className="shrink-0 rounded border px-1.5 text-[10.5px] leading-5 text-muted-foreground">
                    مؤرشفة
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {formatShortDate(c.updatedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
