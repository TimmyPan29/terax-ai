import type { ComponentProps } from "react";
import { lazy, Suspense } from "react";
import type { PdfPreviewPane as PdfPreviewPaneType } from "./PdfPreviewPane";

const PdfPreviewPaneInner = lazy(() =>
  import("./PdfPreviewPane").then((module) => ({
    default: module.PdfPreviewPane,
  })),
);

type Props = ComponentProps<typeof PdfPreviewPaneType>;

export function PdfPreviewPane(props: Props) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
          Loading PDF preview...
        </div>
      }
    >
      <PdfPreviewPaneInner {...props} />
    </Suspense>
  );
}
