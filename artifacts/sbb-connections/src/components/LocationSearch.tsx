import { useState, useEffect, useRef } from "react";
import { useSearchLocations, getSearchLocationsQueryKey, sanitizeSearchQuery, safeArray, safeString, safeId, Location } from "@workspace/api-client-react";
import { useDebounce } from "@/hooks/use-debounce";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MapPin, AlertCircle } from "lucide-react";

export type EnrichedLocation = Location & { dbId?: string | null };

interface LocationSearchProps {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string, location?: EnrichedLocation) => void;
  id: string;
}

export function LocationSearch({ label, placeholder, value, onChange, id }: LocationSearchProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [hasError, setHasError] = useState(false);
  const debouncedQuery = useDebounce(sanitizeSearchQuery(inputValue), 300);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const params = { query: debouncedQuery, type: "station" };
  const { data, isLoading, isError } = useSearchLocations(params, {
    query: {
      enabled: debouncedQuery.length > 1,
      queryKey: getSearchLocationsQueryKey(params),
      retry: 1, // Retry once on failure
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 3000),
    },
  });

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  useEffect(() => {
    setHasError(isError);
  }, [isError]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (station: EnrichedLocation) => {
    try {
      const name = safeString(station.name);
      setInputValue(name);
      onChange(name, {
        ...station,
        name: name,
        id: safeId(station.id),
      });
      setIsOpen(false);
      setHasError(false);
    } catch (error) {
      console.error("Error selecting station:", error);
      setHasError(true);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);
    setHasError(false);
  };

  // Safe data extraction with fallback
  let stations: EnrichedLocation[] = [];
  try {
    stations = (safeArray<Location>(data?.stations) || []).map((station) => ({
      ...station,
      name: safeString(station.name),
      id: safeId(station.id),
      type: safeString(station.type, 50),
    })) as EnrichedLocation[];
  } catch (error) {
    console.error("Error processing stations data:", error);
    setHasError(true);
  }

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
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="pl-10 h-12 bg-background font-medium"
          autoComplete="off"
          maxLength={100}
          aria-invalid={hasError}
        />
      </div>

      {isOpen && debouncedQuery.length > 1 && (
        <div className="absolute z-50 mt-1 w-full bg-card rounded-md border shadow-md max-h-60 overflow-auto">
          {isLoading && (
            <div className="p-4 text-sm text-center text-muted-foreground animate-pulse">
              Loading stations…
            </div>
          )}

          {hasError && !isLoading && (
            <div className="p-4 text-sm text-center text-destructive flex items-center justify-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>Failed to search. Try again.</span>
            </div>
          )}

          {!isLoading && !hasError && stations.length > 0 && (
            <ul className="py-1">
              {stations.map((station) => (
                <li
                  key={station.id || station.name || Math.random()}
                  onClick={() => handleSelect(station)}
                  className="px-4 py-2 hover:bg-accent hover:text-accent-foreground cursor-pointer text-sm transition-colors flex items-center gap-2"
                >
                  <MapPin className="h-3 w-3 text-primary/60 shrink-0" />
                  <span className="font-medium truncate">{station.name}</span>
                </li>
              ))}
            </ul>
          )}

          {!isLoading && !hasError && stations.length === 0 && (
            <div className="p-4 text-sm text-center text-muted-foreground">
              No stations found. Try a different search.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
