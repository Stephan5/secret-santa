import {useRoute} from './router.ts'
import {Admin} from './pages/Admin.tsx'
import {Create} from './pages/Create.tsx'
import {GroupPage} from './pages/GroupPage.tsx'
import {Home, NotFound} from './pages/Home.tsx'

export function App() {
    const route = useRoute()
    switch (route.page) {
        case 'home':
            return <Home />
        case 'create':
            return <Create />
        case 'group':
            return <GroupPage key={route.groupId} groupId={route.groupId} />
        case 'admin':
            return <Admin key={route.groupId} groupId={route.groupId} />
        case 'not-found':
            return <NotFound />
    }
}
