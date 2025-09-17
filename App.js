// App.js (root of your project)
import "react-native-gesture-handler";
import * as React from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import AuthGate from "./AuthGate"; // ← the sign-in screen wrapper
import FertilizerListScreen from "./FertilizerListScreen";
import FertilizerDetailScreen from "./FertilizerDetailScreen";
import MixDirectScreen from "./MixDirectScreen";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function FertilizerStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="FertilizerList"
        component={FertilizerListScreen}
        options={{ title: "Fertilizer List" }}
      />
      <Stack.Screen
        name="FertilizerDetail"
        component={FertilizerDetailScreen}
        options={({ route }) => ({ title: route.params?.name ?? "Fertilizer" })}
      />
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* AuthGate shows the email sign-in first; after login it renders your app */}
      <AuthGate>
        <NavigationContainer>
          <Tab.Navigator
            screenOptions={({ route }) => ({
              headerShown: false,
              tabBarIcon: ({ focused, color, size }) => {
                let icon = "leaf-outline";
                if (route.name === "FertTab") icon = focused ? "leaf" : "leaf-outline";
                if (route.name === "Mix") icon = focused ? "flask" : "flask-outline";
                return <Ionicons name={icon} size={size} color={color} />;
              },
            })}
          >
            <Tab.Screen
              name="FertTab"
              component={FertilizerStack}
              options={{ title: "Fertilizer List" }}
            />
            <Tab.Screen
              name="Mix"
              component={MixDirectScreen}
              options={{ title: "Mix" }}
            />
          </Tab.Navigator>
        </NavigationContainer>
      </AuthGate>
    </GestureHandlerRootView>
  );
}
