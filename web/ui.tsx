import type { ButtonHTMLAttributes, ReactNode } from "react";

export const Card = ({ children, className = "", ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) =>
  <div {...rest} className={`rounded-lg border bg-card p-5 shadow-sm ${className}`}>{children}</div>;

export const Btn = ({ variant = "primary", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" }) =>
  <button {...p} className={`inline-flex h-9 items-center rounded-md px-4 text-sm font-medium disabled:opacity-50 ${variant === "primary" ? "bg-primary text-primary-foreground" : "border bg-background hover:bg-muted"}`} />;

export const Badge = ({ tone, children }: { tone: "red" | "green" | "gray" | "amber"; children: ReactNode }) =>
  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${{ red: "bg-red-500/15 text-red-600", green: "bg-green-500/15 text-green-600", gray: "bg-muted text-muted-foreground", amber: "bg-amber-500/15 text-amber-600" }[tone]}`}>{children}</span>;

export const inputCls = "rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 ring-ring";
