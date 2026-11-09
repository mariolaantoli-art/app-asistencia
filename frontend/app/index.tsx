import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Redirect } from "expo-router";

import { getToken } from "@/src/auth";
import { useTheme } from "@/src/theme";

export default function Index() {
  const { colors } = useTheme();
  const [state, setState] = useState<"loading" | "in" | "out">("loading");

  useEffect(() => {
    getToken().then((t) => setState(t ? "in" : "out"));
  }, []);

  if (state === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }}>
        <ActivityIndicator color={colors.brandPrimary} />
      </View>
    );
  }
  return <Redirect href={state === "in" ? "/(tabs)" : "/bienvenida"} />;
}
