// App.js — Tabs: Mix (Direct), Stock (1:ratio), Fertilizers, Saved
// Stack contains FertilizerDetail.

import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import AuthGate from "./AuthGate";
import MixDirectScreen from "./MixDirectScreen";
import MixStockScreen from "./MixStockScreen";
import FertilizerListScreen from "./FertilizerListScreen";
import FertilizerDetailScreen from "./FertilizerDetailScreen";
import SavedRecipesScreen from "./SavedRecipesScreen";

const Stack = createNativeStackNavigator();
const Tabs = createBottomTabNavigator();

function TabsNav() {
  return (
    <Tabs.Navigator
      screenOptions={({ route }) => ({
        headerShown: true,
        tabBarIcon: ({ color, size }) => {
          const map = {
            Mix: "beaker-outline",          // direct mix
            Stock: "flask-outline",         // 1:ratio stock mix
            Fertilizers: "leaf-outline",
            Saved: "bookmarks-outline",
          };
          return <Ionicons name={map[route.name] || "ellipse-outline"} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="Mix" component={MixDirectScreen} />
      <Tabs.Screen name="Stock" component={MixStockScreen} />
      <Tabs.Screen name="Fertilizers" component={FertilizerListScreen} />
      <Tabs.Screen name="Saved" component={SavedRecipesScreen} />
    </Tabs.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <AuthGate>
          <Stack.Navigator>
            <Stack.Screen name="HomeTabs" component={TabsNav} options={{ headerShown: false }} />
            <Stack.Screen
              name="FertilizerDetail"
              component={FertilizerDetailScreen}
              options={{ title: "Fertilizer" }}
            />
          </Stack.Navigator>
        </AuthGate>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}