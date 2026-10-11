import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth-user';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators/auth.decorators';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, ReorderCategoriesDto, UpdateCategoryDto } from './dto/category.dto';

@ApiTags('Categories')
@Controller({ path: 'categories', version: '1' })
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Public() @Get()
  tree() {
    return this.categories.publicTree();
  }

  @Public() @Get(':slug')
  bySlug(@Param('slug') slug: string) {
    return this.categories.bySlug(slug);
  }
}

@ApiTags('Admin / Categories')
@ApiBearerAuth()
@RequirePermissions('categories.manage')
@Controller({ path: 'admin/categories', version: '1' })
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get() list() { return this.categories.adminList(); }

  @Post() create(@Body() dto: CreateCategoryDto, @CurrentUser() u: AuthUser) {
    return this.categories.create(dto, u.id);
  }

  @Put('reorder') @HttpCode(204)
  reorder(@Body() dto: ReorderCategoriesDto, @CurrentUser() u: AuthUser) {
    return this.categories.reorder(dto, u.id);
  }

  @Patch(':id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() u: AuthUser) {
    return this.categories.update(id, dto, u.id);
  }

  @Delete(':id') @HttpCode(204)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.categories.remove(id, u.id);
  }
}
