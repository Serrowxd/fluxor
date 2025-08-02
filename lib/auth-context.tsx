"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isFeatureEnabled } from "./feature-flags";

interface User {
  user_id: string;
  email: string;
  settings?: {
    low_stock_threshold: number;
    alert_email_enabled: boolean;
    time_zone: string;
  };
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  devLogin: () => Promise<void>;
  demoLogin: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const refreshUser = async () => {
    try {
      // Check if we have a demo user in localStorage (when demo mode is enabled)
      const demoUser = localStorage.getItem("demo_user");
      if (demoUser && isFeatureEnabled("DEMO_MODE_ENABLED")) {
        setUser(JSON.parse(demoUser));
        setLoading(false);
        return;
      }

      // Check if we have a dev user in localStorage (development only)
      const devUser = localStorage.getItem("dev_user");
      if (devUser && process.env.NODE_ENV === "development") {
        setUser(JSON.parse(devUser));
        setLoading(false);
        return;
      }

      const response = await fetch("http://localhost:3001/api/auth/me", {
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (error) {
      console.error("Failed to fetch user:", error);
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshUser();
  }, []);

  const login = async (email: string, password: string) => {
    const response = await fetch("http://localhost:3001/api/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "Login failed");
    }

    const data = await response.json();
    setUser(data.user);
  };

  const devLogin = async () => {
    // Create a dummy user for development
    const dummyUser: User = {
      user_id: "dev-user-123",
      email: "dev@example.com",
      settings: {
        low_stock_threshold: 10,
        alert_email_enabled: true,
        time_zone: "UTC",
      },
    };

    // Store in localStorage to persist across refreshes
    localStorage.setItem("dev_user", JSON.stringify(dummyUser));
    setUser(dummyUser);
  };

  const demoLogin = async () => {
    // Create a demo user for production demo mode
    const demoUser: User = {
      user_id: "demo-user-456",
      email: "demo@inventorymanager.com",
      settings: {
        low_stock_threshold: 15,
        alert_email_enabled: true,
        time_zone: "UTC",
      },
    };

    // Add a small delay to ensure proper state updates
    await new Promise(resolve => setTimeout(resolve, 100));

    // Store in localStorage to persist across refreshes
    localStorage.setItem("demo_user", JSON.stringify(demoUser));
    setUser(demoUser);
    
    // Add another small delay to ensure state is properly set
    await new Promise(resolve => setTimeout(resolve, 100));
  };

  const logout = async () => {
    try {
      // Clear demo and dev users from localStorage
      localStorage.removeItem("demo_user");
      localStorage.removeItem("dev_user");

      await fetch("http://localhost:3001/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setUser(null);
      router.push("/login");
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, refreshUser, devLogin, demoLogin }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
