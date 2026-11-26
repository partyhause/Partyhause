from django.urls import path

from . import views

urlpatterns = [
    path('', views.IndexStickiesView.as_view(), name='stickies'),
    path('create/', views.CreateStickyView.as_view(), name='create_sticky'),
    path(
        '<uuid:sticky_id>/position/',
        views.UpdateStickyPositionView.as_view(),
        name='update_sticky_position',
    ),
    path(
        '<uuid:sticky_id>/vote/',
        views.UpdateStickyVoteView.as_view(),
        name='update_sticky_vote',
    ),
    # The web and shared clients call `convert-to-task`; the older route was
    # `task/`. Both resolve to the same view so neither client 404s.
    path(
        '<uuid:sticky_id>/convert-to-task/',
        views.CreateTaskFromStickyView.as_view(),
        name='convert_sticky_to_task',
    ),
    path(
        '<uuid:sticky_id>/task/',
        views.CreateTaskFromStickyView.as_view(),
        name='create_task_from_sticky',
    ),
    path('<uuid:sticky_id>/', views.DeleteStickyView.as_view(), name='delete_sticky'),
]
