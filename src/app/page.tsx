import { redirect } from "next/navigation";

type SearchParamsValue = string | string[] | undefined;
type SearchParamsMap = Record<string, SearchParamsValue>;

type HomePageProps = {
  searchParams?: SearchParamsMap | Promise<SearchParamsMap>;
};

const isPromise = <T,>(value: unknown): value is Promise<T> => {
  return typeof value === "object" && value !== null && "then" in value;
};

const resolveRef = (value: SearchParamsValue): string => {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first.trim() : "";
  }
  return typeof value === "string" ? value.trim() : "";
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const resolved = isPromise<SearchParamsMap>(searchParams) ? await searchParams : searchParams ?? {};
  const ref = resolveRef(resolved.ref);
  if (ref) {
    redirect(`/casino/games/dice?ref=${encodeURIComponent(ref)}`);
  }
  redirect("/casino/games/dice");
}
