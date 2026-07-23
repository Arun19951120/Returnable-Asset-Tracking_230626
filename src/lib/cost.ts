import type { Asset } from "./types";

/**
 * The declared value of an asset at a given location.
 *
 * Assets can carry a per-location cost (e.g. it's worth X at location "1.a"
 * but Y at "1.b"). When a location-specific cost exists we use it; otherwise
 * we fall back to the asset's baseline `cost`.
 */
export function assetValueAt(asset: Pick<Asset, "cost" | "locationCosts">, location?: string): number {
  if (location && asset.locationCosts && typeof asset.locationCosts[location] === "number") {
    return asset.locationCosts[location];
  }
  return asset.cost ?? 0;
}
