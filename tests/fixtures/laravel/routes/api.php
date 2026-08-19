<?php

use App\Http\Controllers\CourseController;
use Illuminate\Support\Facades\Route;

Route::get('/api/courses', [CourseController::class, 'index']);
Route::post('/api/courses', [CourseController::class, 'store'])->middleware('auth:sanctum');
Route::get('/api/courses/{id}', [CourseController::class, 'show']);
Route::delete('/api/courses/{id}', [CourseController::class, 'destroy'])->middleware('auth:sanctum');
