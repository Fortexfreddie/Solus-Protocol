import useSWR from "swr";
import { getPrices } from "@/lib/api";
import type { TokenPrice } from "@/types";

const TOKEN_ORDER = ["SOL", "USDC", "RAY", "BONK"] as const;

async function fetchPrices(): Promise<TokenPrice[]> {
    const { prices: raw } = await getPrices();
    const priceMap = raw.prices;

    return TOKEN_ORDER.map((symbol): TokenPrice => {
        const entry = priceMap[symbol];
        if (!entry) {
            return { symbol, price: 0, change24h: 0, direction: "flat" };
        }
        return {
            symbol,
            price: entry.usd,
            change24h: entry.change24h,
            direction: entry.change24h > 0.01 ? "up" : entry.change24h < -0.01 ? "down" : "flat",
        };
    });
}

export function usePrices() {
    const { data, error, isLoading, mutate } = useSWR<TokenPrice[]>(
        "prices",
        fetchPrices,
        {
            refreshInterval: 15_000,
            revalidateOnFocus: false,
            dedupingInterval: 10_000,
        }
    );

    return {
        prices: data ?? [],
        isLoading,
        error,
        mutate,
    };
}
