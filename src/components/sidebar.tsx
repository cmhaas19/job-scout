"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  Compass,
  LayoutDashboard,
  Search,
  FileText,
  History,
  Settings,
  ScrollText,
  Users,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "./ui/button";

interface SidebarProps {
  userRole: string;
  userEmail: string;
}

const overviewLinks = [
  { href: "/", label: "Home", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
];

const setupLinks = [
  { href: "/setup/searches", label: "Searches", icon: Search },
  { href: "/setup/resume", label: "Resume", icon: FileText },
];

const systemLinks = [
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/prompts", label: "Prompts", icon: ScrollText },
  { href: "/admin/run-logs", label: "Run Logs", icon: History },
  { href: "/admin/users", label: "Users", icon: Users },
];

export function Sidebar({ userRole, userEmail }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Close user menu when clicking outside
  useEffect(() => {
    if (!userMenuOpen) return;
    function handleClick() {
      setUserMenuOpen(false);
    }
    // Delay to avoid the toggle click immediately closing
    const timer = setTimeout(() => {
      document.addEventListener("click", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("click", handleClick);
    };
  }, [userMenuOpen]);

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const navContent = (
    <>
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3 py-1">
        <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center">
          <Compass className="h-5 w-5 text-white" />
        </div>
        <span className="text-lg font-bold">Job Scout</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 mt-6">
        {/* Overview */}
        <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Overview
        </p>
        {overviewLinks.map((link) => {
          const isActive =
            link.href === "/"
              ? pathname === "/"
              : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}

        {/* Setup */}
        <div className="pt-4">
          <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            Setup
          </p>
        </div>
        {setupLinks.map((link) => {
          const isActive = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              <link.icon className="h-4 w-4" />
              {link.label}
            </Link>
          );
        })}

        {/* System (admin only) */}
        {userRole === "admin" && (
          <>
            <div className="pt-4">
              <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                System
              </p>
            </div>
            {systemLinks.map((link) => {
              const isActive = pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <link.icon className="h-4 w-4" />
                  {link.label}
                </Link>
              );
            })}
          </>
        )}
      </nav>

      {/* User section */}
      <div className="border-t pt-4 relative">
        {/* Popover menu */}
        {userMenuOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-2 rounded-lg border bg-background shadow-lg py-1">
            <button
              onClick={() => {
                handleSignOut();
                setUserMenuOpen(false);
              }}
              className="flex items-center gap-3 px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground w-full cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        )}

        {/* Profile button */}
        <button
          onClick={() => setUserMenuOpen(!userMenuOpen)}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted w-full cursor-pointer"
        >
          <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center shrink-0">
            <span className="text-sm font-semibold text-primary-foreground">
              {userEmail.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="text-left min-w-0">
            <p className="text-sm font-medium truncate">{userEmail}</p>
            <p className="text-xs text-muted-foreground capitalize">{userRole}</p>
          </div>
        </button>
      </div>
    </>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-background/80 backdrop-blur-sm border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <Compass className="h-4 w-4 text-white" />
          </div>
          <span className="font-bold">Job Scout</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-30 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <aside
        className={cn(
          "lg:hidden fixed top-0 left-0 z-40 h-full w-72 bg-sidebar border-r p-4 flex flex-col transform transition-transform duration-200",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {navContent}
      </aside>

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 bg-sidebar border-r p-4">
        {navContent}
      </aside>
    </>
  );
}
