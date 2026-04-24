import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-black px-4 text-center">
      <img
        src="/404-illustration.png"
        alt=""
        className="max-h-[min(42.5vh,450px)] w-auto max-w-full object-contain"
      />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        Ошибка 404
      </h1>
      <p className="mt-3 max-w-md text-balance text-sm text-zinc-400 sm:text-base">
        Страница не найдена. Возможно, ссылка устарела или адрес введён с ошибкой.
      </p>
      <a
        href="/"
        className="mt-8 text-sm text-red-500/90 underline decoration-red-500/40 underline-offset-4 hover:text-red-400"
      >
        На главную
      </a>
    </div>
  );
};

export default NotFound;
