'use client';

import {
  MapPin, ExternalLink, AlertTriangle, Compass, Wrench,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { DiscoveredShop } from './types';

interface DiscoveryStripProps {
  shop: DiscoveredShop;
}

export function DiscoveryStrip({ shop }: DiscoveryStripProps) {
  const chainTag = (shop.raw_data as Record<string, unknown> | null)?.['chain_tag'];

  return (
    <div className="bg-cyan-50/60 rounded-xl border border-cyan-200/60 px-4 py-3 mb-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-cyan-700">
          <Compass className="w-4 h-4" />
          <span className="text-xs font-semibold uppercase tracking-wide">Discovery</span>
        </div>

        {shop.google_maps_url && (
          <a
            href={shop.google_maps_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-cyan-700 bg-white hover:bg-cyan-50 rounded border border-cyan-200"
          >
            <MapPin className="w-3 h-3" />
            Open in Google Maps
            <ExternalLink className="w-2.5 h-2.5" />
          </a>
        )}

        {shop.shop_type && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-cyan-100 text-cyan-700">
            <Wrench className="w-3 h-3" />
            {shop.shop_type}
          </span>
        )}

        {chainTag != null && (
          <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
            chain · {String(chainTag)}
          </span>
        )}

        {shop.email_status && (
          <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full ${
            shop.email_status === 'valid'     ? 'bg-emerald-100 text-emerald-700' :
            shop.email_status === 'catch_all' ? 'bg-amber-100 text-amber-700' :
                                                'bg-slate-100 text-slate-600'
          }`}>
            email: {shop.email_status}
          </span>
        )}

        {shop.permanently_closed && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700">
            <AlertTriangle className="w-3 h-3" />
            permanently closed
          </span>
        )}

        {shop.temporarily_closed && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-amber-100 text-amber-700">
            <AlertTriangle className="w-3 h-3" />
            temporarily closed
          </span>
        )}

        <div className="ml-auto text-[10px] text-cyan-700/70">
          scraped {shop.scraped_at ? formatDistanceToNow(new Date(shop.scraped_at), { addSuffix: true }) : 'recently'}
          {shop.source && <> · {shop.source}</>}
        </div>
      </div>

      {shop.description && (
        <p className="text-xs text-slate-600 leading-relaxed mt-2 pt-2 border-t border-cyan-200/60">
          {shop.description}
        </p>
      )}
    </div>
  );
}
