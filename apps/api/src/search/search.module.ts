import { Module } from '@nestjs/common';
import { PostgresSearchEngine } from './postgres-search.engine';
import { AdminSearchController, SearchController } from './search.controller';
import { SearchInsights } from './search-insights.service';
import { SearchService } from './search.service';
import { SearchEngine } from './search.types';

@Module({
  controllers: [SearchController, AdminSearchController],
  // To move to Typesense later: replace PostgresSearchEngine here with TypesenseSearchEngine.
  providers: [SearchService, SearchInsights, { provide: SearchEngine, useClass: PostgresSearchEngine }],
  exports: [SearchService, SearchEngine, SearchInsights],
})
export class SearchModule {}
