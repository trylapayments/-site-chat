import React from "react";
import { Redirect } from "expo-router";
import { useMill } from "../lib/session";
import { Loading } from "../components/ui";
export default function Index() {
  const { ready, session } = useMill();
  return !ready ? <Loading /> : <Redirect href={session ? "/inbox" : "/login"} />;
}
