import * as React from "react";
import { Dialog as Primitive, Slot } from "radix-ui";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { X, LoaderCircle } from "lucide-react";
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
const buttonVariants = cva("button", {
  variants: {
    variant: {
      default: "button-primary",
      outline: "button-outline",
      ghost: "button-ghost",
      destructive: "button-danger",
    },
    size: { default: "", sm: "button-sm", icon: "button-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export function Button({
  className,
  variant,
  size,
  asChild = false,
  busy,
  disabled,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; busy?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || busy}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {busy ? <LoaderCircle className="spin" size={16} /> : null}
          {children}
        </>
      )}
    </Comp>
  );
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("input", props.className)} />;
}
export function Textarea(
  props: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea {...props} className={cn("input textarea", props.className)} />
  );
}
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn("input", props.className)} />;
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = React.useId();
  function associate(nodes: React.ReactNode): React.ReactNode {
    return React.Children.map(nodes, (node) => {
      if (!React.isValidElement(node)) return node;
      const child = node as React.ReactElement<any>;
      if (
        [Input, Textarea, Select, "input", "textarea", "select"].includes(
          child.type as any,
        )
      )
        return React.cloneElement(child, {
          id,
          "aria-describedby": hint ? id + "-hint" : undefined,
        });
      return child.props.children
        ? React.cloneElement(child, {}, associate(child.props.children))
        : child;
    });
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {associate(children)}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Primitive.Root open={open} onOpenChange={onOpenChange}>
      <Primitive.Portal>
        <Primitive.Overlay className="dialog-overlay" />
        <Primitive.Content className="dialog-content">
          <div className="dialog-heading">
            <Primitive.Title>{title}</Primitive.Title>
            <Primitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close dialog">
                <X size={18} />
              </Button>
            </Primitive.Close>
          </div>
          <Primitive.Description className="muted">
            {description || "Complete the details below."}
          </Primitive.Description>
          {children}
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
