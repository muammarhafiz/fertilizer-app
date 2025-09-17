// App.js — Tabs: Mix, Fertilizers, Saved. Stack contains FertilizerDetail.

import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import AuthGate from "./AuthGate";
import MixDirectScreen from "./MixDirectScreen";
import FertilizerListScreen from "./FertilizerListScreen";
import FertilizerDetailScreen from "./FertilizerDetailScreen"; // you already have this
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
            Mix: "beaker-outline",
            Fertilizers: "leaf-outline",
            Saved: "bookmarks-outline",
          };
          return <Ionicons name={map[route.name] || "ellipse-outline"} size={size} color={color} />;
        },
      })}
    >
      <Tabs.Screen name="Mix" component={MixDirectScreen} />
      <Tabs.Screen name="Fertilizers" component={FertilizerListScreen} />
      <Tabs.Screen name="Saved" component={SavedRecipesScreen} />
    </Tabs.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <AuthGate>
        <Stack.Navigator>
          <Stack.Screen name="HomeTabs" component={TabsNav} options={{ headerShown: false }} />
          <Stack.Screen name="FertilizerDetail" component={FertilizerDetailScreen} options={{ title: "Fertilizer" }} />
        </Stack.Navigator>
      </AuthGate>
    </NavigationContainer>
  );
}