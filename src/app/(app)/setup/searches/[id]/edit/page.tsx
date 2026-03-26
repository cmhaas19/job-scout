import { redirect } from "next/navigation";

export default function EditSearchRedirect() {
  redirect("/setup/searches");
}
