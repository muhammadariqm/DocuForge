<?php

namespace App\Http\Controllers;

use App\Services\CourseService;

class CourseController extends Controller
{
    public function __construct(private CourseService $courseService)
    {
    }

    public function index()
    {
        return $this->courseService->all();
    }

    public function store()
    {
        return $this->courseService->create(request()->all());
    }

    public function show(int $id)
    {
        return $this->courseService->find($id);
    }

    public function destroy(int $id)
    {
        return $this->courseService->delete($id);
    }
}
