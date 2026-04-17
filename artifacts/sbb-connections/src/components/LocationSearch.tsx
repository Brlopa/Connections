import React, { useState, useEffect, useRef } from "react";
import { useSearchLocations, getSearchLocationsQueryKey } from "@workspace/api-client-react";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin } from "lucide-react";
import type { Location } from "@workspace/api-client-react/src/generated/api.schemas";

interface LocationSearchProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string, location?: Location) => void;
  id: string;
}

export function LocationSearch({ label, placeholder, value, onChange, id }: LocationSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const debouncedQuery = useDebounce(inputValue, 300);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useSearchLocations(
    { query: debouncedQuery, type: "station" },
    { query: { enabled: debouncedQuery.length > 1, queryKey: getSearchLocationsQueryKey({ query: debouncedQuery, type: "station" }) } }
  );

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (station: Location) => {
    const name = station.name || "";
    setInputValue(name);
    onChange(name, station);
    setIsOpen(false);
  };

  return (
    <div className="relative flex-1" ref={wrapperRef}>
      <Label htmlFor={id} className="text-sm font-semibold mb-1.5 block text-muted-foreground">
        {label}
      </Label>
      <div className="relative">
        <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          id={id}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            onChange(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="pl-10 h-12 bg-background font-medium"
          autoComplete="off"
        />
      </div>

      {isOpen && debouncedQuery.length > 1 && (
        <div className="absolute z-50 mt-1 w-full bg-card rounded-md border shadow-md max-h-60 overflow-auto">
          {isLoading ? (
            <div className="p-4 text-sm text-center text-muted-foreground animate-pulse">Loading stations...</div>
          ) : data?.stations && data.stations.length > 0 ? (
            <ul className="py-1">
              {data.stations.map((station) => (
                <li
                  key={station.id || station.name}
                  onClick={() => handleSelect(station)}
                  className="px-4 py-2 hover:bg-accent hover:text-accent-foreground cursor-pointer text-sm transition-colors flex items-center gap-2"
                >
                  <MapPin className="h-3 w-3 text-primary/60" />
                  <span className="font-medium">{station.name}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 text-sm text-center text-muted-foreground">No stations found.</div>
          )}
        </div>
      )}
    </div>
  );
}
