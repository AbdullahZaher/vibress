import type { AnchorHTMLAttributes } from "react";
import { getPreviewNavigation } from "../../lib/preview-link-server";
import { toPreviewHref } from "../../lib/preview-links";

/** Preserve validated theme preview context during ordinary anchor navigation. */
export async function PreviewAnchor({
  href,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const navigation = await getPreviewNavigation();
  return <a {...rest} href={href ? toPreviewHref(href, navigation) : href} />;
}
