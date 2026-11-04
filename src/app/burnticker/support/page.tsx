import { permanentRedirect } from "next/navigation";

/** /burnticker/support (sixth-pass audit OP6-11: it answered 404): the contact page holds the addresses. */
export default function SupportPage(): never {
  permanentRedirect("/burnticker/contact");
}
