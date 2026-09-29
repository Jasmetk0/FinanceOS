export const PROVIDER_COLORS: Record<string, string> = {
  trading212: "#4f8cff",
  kraken: "#a970ff",
  investown: "#f4ad45",
  mintos: "#2fcf91",
  phantom: "#ab9ff2",
  manual: "#94a3b8",
};

export const PROVIDER_LABELS: Record<string, string> = {
  trading212: "Trading 212",
  kraken: "Kraken",
  investown: "Investown",
  mintos: "Mintos",
  phantom: "Phantom",
  manual: "Manual",
  "unlinked-wallet": "Nenapojená vlastní peněženka",
};

const FALLBACK_COLORS = [
  "#42c7c7",
  "#ff7f8e",
  "#d7b95f",
  "#7f9cf5",
  "#d38df0",
  "#6fce7e",
];

function hash(value: string) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) >>> 0;
  }
  return result;
}

export function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] || provider;
}

export function providerColor(provider: string) {
  return (
    PROVIDER_COLORS[provider] ||
    FALLBACK_COLORS[hash(provider) % FALLBACK_COLORS.length]
  );
}
