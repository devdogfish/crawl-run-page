import { redirect } from "next/navigation";

// Prototype entry: open a sample crawl. In the real app /crawls is your crawl list.
export default function Home() {
  redirect("/crawls/812");
}
