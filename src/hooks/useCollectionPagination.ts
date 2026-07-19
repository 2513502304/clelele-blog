import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_COLLECTION_PAGE_SIZE, MAX_COLLECTION_PAGE_SIZE, MIN_COLLECTION_PAGE_SIZE } from '@/constants/pagination';

interface StoredPaginationSettings {
  isPaginated: boolean;
  pageSize: number;
}

/**
 * 为已经加载到客户端的集合提供统一分页，并按 `storageKey` 保存分页模式和每页数量。
 * 数据筛选导致总页数缩小时会夹紧当前页；关闭分页只改变 `visibleItems`，不会改变上游抓取行为。
 */
export function useCollectionPagination<T>(items: T[], storageKey: string) {
  const [isPaginated, setIsPaginated] = useState(true);
  const [pageSize, setPageSize] = useState(DEFAULT_COLLECTION_PAGE_SIZE);
  const [currentPage, setCurrentPage] = useState(1);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const settings = JSON.parse(stored) as Partial<StoredPaginationSettings>;
        if (typeof settings.isPaginated === 'boolean') setIsPaginated(settings.isPaginated);
        const storedPageSize = settings.pageSize;
        if (
          typeof storedPageSize === 'number' &&
          Number.isInteger(storedPageSize) &&
          storedPageSize >= MIN_COLLECTION_PAGE_SIZE &&
          storedPageSize <= MAX_COLLECTION_PAGE_SIZE
        ) {
          setPageSize(storedPageSize);
        }
      }
    } catch {
      localStorage.removeItem(storageKey);
    } finally {
      setSettingsLoaded(true);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!settingsLoaded) return;
    localStorage.setItem(storageKey, JSON.stringify({ isPaginated, pageSize }));
  }, [isPaginated, pageSize, settingsLoaded, storageKey]);

  const totalPages = isPaginated ? Math.max(1, Math.ceil(items.length / pageSize)) : 1;

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const visibleItems = useMemo(() => {
    if (!isPaginated) return items;
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [currentPage, isPaginated, items, pageSize]);

  function updatePaginationMode(value: boolean) {
    setIsPaginated(value);
    setCurrentPage(1);
  }

  function updatePageSize(value: number) {
    setPageSize(value);
    setCurrentPage(1);
  }

  return {
    currentPage,
    isPaginated,
    pageSize,
    setCurrentPage,
    setIsPaginated: updatePaginationMode,
    setPageSize: updatePageSize,
    totalPages,
    visibleItems,
  };
}
