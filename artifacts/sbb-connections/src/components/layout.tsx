import React from "react";
import { Link, useLocation } from "wouter";
import { Train, Clock, MapPin } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  return (
    <div className="min-h-[100dvh] bg-background flex flex-col text-foreground font-sans">
      <header className="sticky top-0 z-50 w-full border-b bg-card shadow-sm">
        <div className="container max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl text-primary tracking-tight">
            <Train className="h-6 w-6" />
            <span>Connections</span>
          </Link>
          
          <nav className="flex items-center gap-1">
            <Link 
              href="/" 
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${location === "/" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              Search
            </Link>
            <Link 
              href="/stationboard" 
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${location === "/stationboard" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              Stationboard
            </Link>
            <Link 
              href="/lines" 
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${location === "/lines" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              Lines
            </Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 container max-w-5xl mx-auto p-4 md:py-8">
        {children}
      </main>
      <footer className="border-t py-6 bg-card text-center text-sm text-muted-foreground">
        <p className="flex items-center justify-center gap-2">
          <Train className="h-4 w-4" /> Data provided by SBB Transport API
        </p>
      </footer>
    </div>
  );
}
