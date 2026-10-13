import type { Metadata } from "next";
import { Lend } from "@/components/lend/Lend";

export const metadata: Metadata = { title: "Lend · Kollat" };

export default function LendPage() {
  return <Lend />;
}
