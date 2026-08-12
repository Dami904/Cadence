"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";

// Circle names live off-chain (see app/api/circle-name) — createCircle() takes no name
// parameter, so there's nowhere onchain for the label entered at creation to persist.
export function useCircleName(circleAddress: Address | null) {
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    if (!circleAddress) {
      setName(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/circle-name?address=${circleAddress}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setName((data.name as string | null) ?? null);
      })
      .catch(() => {
        if (!cancelled) setName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [circleAddress]);

  return name;
}

export function useCircleNames(circleAddresses: Address[]) {
  const key = circleAddresses.join(",");
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (circleAddresses.length === 0) {
      setNames({});
      return;
    }
    let cancelled = false;
    fetch(`/api/circle-name?addresses=${circleAddresses.join(",")}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setNames((data.names as Record<string, string>) ?? {});
      })
      .catch(() => {
        if (!cancelled) setNames({});
      });
    return () => {
      cancelled = true;
    };
    // Re-runs only when the actual set of addresses changes, not on every render of a new array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return names;
}
