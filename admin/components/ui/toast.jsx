"use client";
import { Toast } from "@base-ui/react/toast";
import { Check, X } from "lucide-react";

/** Wrap the app: <ToastProvider>…</ToastProvider>. Then: const t = useToast(); t.add({ title: "Config v43 published" }) */
export function ToastProvider({ children }) {
  return (
    <Toast.Provider timeout={3200}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed bottom-5 right-5 z-[60] flex w-[23.75rem] max-w-[calc(100vw-2.5rem)] flex-col gap-2">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((t) => (
    <Toast.Root key={t.id} toast={t} className="flex items-center gap-2.5 rounded-lg border border-border bg-popover py-2.5 pl-3 pr-2 text-[0.8125rem] text-popover-foreground shadow-xl transition-all data-[starting-style]:translate-y-2 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0">
      <span className={"flex size-5 shrink-0 items-center justify-center rounded-full " + (t.type === "error" ? "bg-destructive-soft text-destructive" : "bg-success-soft text-success")}>
        {t.type === "error" ? <X className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </span>
      <div className="flex-1"><Toast.Title />{t.description && <Toast.Description className="text-xs text-muted-foreground" />}</div>
      <Toast.Close aria-label="Dismiss" className="flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-accent"><X className="size-3.5" /></Toast.Close>
    </Toast.Root>
  ));
}
export const useToast = Toast.useToastManager;
